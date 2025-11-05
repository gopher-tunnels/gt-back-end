import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { driver } from '../controller/db';
import { parseBooleanEnv } from '../utils/httpConfig';

dotenv.config();

type RawBodyRequest = Request & { rawBody?: string };
type RejectionContext = Record<string, unknown>;

const MAX_SKEW_SECONDS = readPositiveIntEnv('API_REQUEST_MAX_SKEW_SEC', 300);
const REPLAY_TTL_SECONDS = readPositiveIntEnv('API_REQUEST_TTL_SEC', 600);
const RATE_LIMIT_WINDOW_MS = readPositiveIntEnv('API_RATE_LIMIT_WINDOW_MS', 60_000);
const RATE_LIMIT_MAX = readPositiveIntEnv('API_RATE_LIMIT_MAX', 100);
const DEBUG_SECURITY = parseBooleanEnv('API_SECURITY_DEBUG', false);

export function buildRateLimiter(
  options: { validateXForwardedFor?: boolean } = {},
) {
  const { validateXForwardedFor = true } = options;
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: validateXForwardedFor },
    handler: (req, res) => {
      logSecurityRejection(req as RawBodyRequest, 'rate-limit', {
        limitWindowMs: RATE_LIMIT_WINDOW_MS,
        limitMax: RATE_LIMIT_MAX,
      });
      res.status(429).json({ error: 'Too many requests' });
    },
  });
}

export async function requestSecurityMiddleware(
  req: RawBodyRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  const deviceId = req.header('X-Device-Id');
  const timestamp = req.header('X-Timestamp');
  const nonce = req.header('X-Nonce');
  const signatureHeader = req.header('X-Signature');

  const reject = (
    status: number,
    publicMessage: string,
    reason: string,
    context: RejectionContext = {},
  ) => {
    logSecurityRejection(req, reason, {
      ...context,
      deviceId,
      nonce,
      timestamp,
    });
    res.status(status).json({ error: publicMessage });
  };

  if (!deviceId || !timestamp || !nonce || !signatureHeader) {
    reject(400, 'Missing authentication headers', 'missing-headers');
    return;
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    reject(400, 'Invalid timestamp', 'invalid-timestamp');
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_SKEW_SECONDS) {
    reject(401, 'Stale timestamp', 'stale-timestamp', {
      skewSeconds: nowSeconds - timestampSeconds,
    });
    return;
  }

  const rawBody = req.rawBody ?? '';
  const pathVariants = buildPathVariants(req.originalUrl || req.url);
  const canonicalCandidates = buildCanonicalCandidates({
    method: req.method,
    paths: pathVariants,
    body: rawBody,
    deviceId,
    timestamp,
    nonce,
  });

  let signatureBuffer: Buffer;
  try {
    signatureBuffer = Buffer.from(signatureHeader, 'base64');
  } catch {
    reject(401, 'Bad signature', 'invalid-signature-base64');
    return;
  }

  if (signatureBuffer.length === 0) {
    reject(401, 'Bad signature', 'empty-signature');
    return;
  }

  let secrets: string[];
  try {
    secrets = getSharedSecrets();
  } catch (err) {
    console.error('Shared secret configuration error:', err);
    reject(500, 'Server configuration error', 'missing-shared-secret');
    return;
  }
  const signatureValid = secrets.some((secret) =>
    canonicalCandidates.some((canonical) =>
      constantTimeEquals(signatureBuffer, computeHmac(secret, canonical)),
    ),
  );

  if (!signatureValid) {
    reject(401, 'Bad signature', 'signature-mismatch', {
      canonicalHashes: canonicalCandidates.map(hashCanonical),
      canonicalPaths: pathVariants,
    });
    return;
  }

  try {
    const replay = await isReplay(deviceId, nonce);
    if (replay) {
      reject(401, 'Replay detected', 'nonce-replay');
      return;
    }
  } catch (err) {
    console.error('Replay protection lookup failed:', err);
    reject(503, 'Unable to validate request nonce', 'nonce-lookup-failed');
    return;
  }

  next();
}

function computeHmac(secret: string, canonical: string): Buffer {
  return crypto.createHmac('sha256', secret).update(canonical).digest();
}

function constantTimeEquals(expected: Buffer, candidate: Buffer): boolean {
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

function normalizePathWithQuery(pathAndQuery: string): string {
  if (!pathAndQuery) return '/';
  return pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function getSharedSecrets(): string[] {
  const secrets = [
    process.env.API_SHARED_SECRET_ACTIVE,
    process.env.API_SHARED_SECRET_OLD,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (secrets.length === 0) {
    throw new Error('API shared secret is not configured');
  }

  return secrets;
}

async function isReplay(deviceId: string, nonce: string): Promise<boolean> {
  const session = driver.session({ database: 'neo4j' });
  try {
    const expiresAtIso = new Date(Date.now() + REPLAY_TTL_SECONDS * 1000).toISOString();
    const result = await session.executeWrite((tx) =>
      tx.run(
        `
        MERGE (n:Nonce { deviceId: $deviceId, nonce: $nonce })
        ON CREATE SET
          n.createdAt = datetime(),
          n.expiresAt = datetime($expiresAtIso),
          n._justCreated = true
        ON MATCH SET
          n._justCreated = false
        WITH n, n._justCreated AS justCreated, n.expiresAt AS previousExpires
        SET
          n.lastSeen = datetime(),
          n.expiresAt = CASE
            WHEN justCreated OR previousExpires IS NULL OR previousExpires < datetime()
              THEN datetime($expiresAtIso)
            ELSE n.expiresAt
          END
        REMOVE n._justCreated
        RETURN justCreated AS wasCreated, previousExpires >= datetime() AS wasStillValid
      `,
        { deviceId, nonce, expiresAtIso },
      ),
    );

    const record = result.records[0];
    if (!record) {
      return false;
    }

    const wasCreated = Boolean(record.get('wasCreated'));
    if (wasCreated) {
      return false;
    }

    return Boolean(record.get('wasStillValid'));
  } finally {
    await session.close();
  }
}

function logSecurityRejection(
  req: RawBodyRequest,
  reason: string,
  context: RejectionContext = {},
): void {
  const basePayload = {
    reason,
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip,
  };

  if (DEBUG_SECURITY) {
    console.warn('[request-security]', {
      ...basePayload,
      ...context,
    });
  } else {
    console.warn('[request-security]', basePayload);
  }
}

function hashCanonical(canonical: string): string {
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function buildPathVariants(pathAndQuery: string): string[] {
  const primary = normalizePathWithQuery(pathAndQuery);
  const variants = new Set<string>([primary]);
  const normalized = normalizeQueryEncoding(primary);
  variants.add(normalized);
  return Array.from(variants);
}

function normalizeQueryEncoding(pathAndQuery: string): string {
  const questionMarkIndex = pathAndQuery.indexOf('?');
  if (questionMarkIndex === -1) {
    return pathAndQuery;
  }

  const pathname = pathAndQuery.slice(0, questionMarkIndex);
  const queryString = pathAndQuery.slice(questionMarkIndex + 1);

  if (!queryString) {
    return pathname;
  }

  const parts = queryString.split('&');
  const normalizedParts = parts.map((part) => {
    if (!part) return '';
    const equalIndex = part.indexOf('=');
    if (equalIndex === -1) {
      return encodeComponent(decodeComponent(part));
    }
    const key = part.slice(0, equalIndex);
    const value = part.slice(equalIndex + 1);
    return `${encodeComponent(decodeComponent(key))}=${encodeComponent(
      decodeComponent(value),
    )}`;
  });

  const serialized = normalizedParts.filter((p) => p.length > 0).join('&');
  return serialized ? `${pathname}?${serialized}` : pathname;
}

function decodeComponent(component: string): string {
  return decodeURIComponent(component.replace(/\+/g, ' '));
}

function encodeComponent(component: string): string {
  return encodeURIComponent(component);
}

function buildCanonicalCandidates(params: {
  method: string;
  paths: string[];
  body: string;
  deviceId: string;
  timestamp: string;
  nonce: string;
}): string[] {
  const method = params.method.toUpperCase();
  const uniquePaths = Array.from(new Set(params.paths));

  return uniquePaths.map((path) =>
    [method, path, params.body, params.deviceId, params.timestamp, params.nonce].join('\n'),
  );
}
