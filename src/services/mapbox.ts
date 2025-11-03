import axios from 'axios';

interface Coordinates {
  latitude: number;
  longitude: number;
}

const mapboxClient = axios.create({
  baseURL: 'https://api.mapbox.com/directions/v5/mapbox',
});

export async function getMapboxWalkingDirections(
  origin: Coordinates,
  destination: Coordinates,
) {
  const accessToken = process.env.MAPBOX_API_KEY;

  if (!accessToken) {
    throw new Error('Missing MAPBOX_API_KEY environment variable');
  }

  const response = await mapboxClient.get(
    `walking/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`,
    {
      params: {
        access_token: accessToken,
        alternatives: false,
        continue_straight: true,
        geometries: 'geojson',
        overview: 'full',
        steps: true,
      },
    },
  );
  return response.data;
}
