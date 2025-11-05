import axios from 'axios';

interface Coordinates {
  latitude: number;
  longitude: number;
}

const googleMapsClient = axios.create({
  baseURL: 'https://maps.googleapis.com/maps/api',
});

export async function getGoogleWalkingDirections(
  origin: Coordinates,
  destination: Coordinates,
) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    throw new Error('Missing GOOGLE_MAPS_API_KEY environment variable');
  }

  const response = await googleMapsClient.get('/directions/json', {
    params: {
      origin: `${origin.latitude}, ${origin.longitude}`,
      destination: `${destination.latitude}, ${destination.longitude}`,
      mode: 'walking',
      key: apiKey,
    },
  });
  return response.data;
}
