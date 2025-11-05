import type { Application } from 'express';

export type TrustProxySetting = boolean | number | string[];

export function parseTrustProxy(
  rawValue: string | undefined,
): TrustProxySetting {
  if (!rawValue) return false;

  const trimmed = rawValue.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;

  const hopCount = Number(trimmed);
  if (Number.isInteger(hopCount) && hopCount >= 0) return hopCount;

  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function applyTrustProxy(
  app: Application,
  trustProxy: TrustProxySetting,
): void {
  if (trustProxy === false) {
    return;
  }

  app.set('trust proxy', trustProxy);
}

export function parseBooleanEnv(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}
