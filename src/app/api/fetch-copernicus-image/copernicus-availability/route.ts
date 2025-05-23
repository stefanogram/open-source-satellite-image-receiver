import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const logFilePath = path.join(process.cwd(), 'logs', 'api-requests.log');

const appendLog = async (message: string) => {
  try {
    await fs.appendFile(logFilePath, message + '\n');
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
};

// Helper to fetch available scenes from Copernicus Catalog API (±7 days)
async function fetchAvailableScenes({ lat, lon, date, time, timezone, intervalMinutes = 1440, dateRangeDays = 7, dim = 0.2 }: {
  lat: number;
  lon: number;
  date: string;
  time: string;
  timezone: string;
  intervalMinutes?: number;
  dateRangeDays?: number;
  dim?: number;
}) {
  const halfDim = dim / 2;
  const bbox = [lon - halfDim, lat - halfDim, lon + halfDim, lat + halfDim];
  const dateObj = new Date(date);
  const from = new Date(dateObj.getTime() - dateRangeDays * 24 * 60 * 60 * 1000);
  const to = new Date(dateObj.getTime() + dateRangeDays * 24 * 60 * 60 * 1000);
  const dateFrom = from.toISOString();
  const dateTo = to.toISOString();
  const catalogUrl = 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/collections/sentinel-2-l2a/items';
  const params = new URLSearchParams({
    bbox: bbox.join(','),
    datetime: `${dateFrom}/${dateTo}`,
    limit: '20',
  });
  const clientId = process.env.COPERNICUS_CLIENT_ID;
  const clientSecret = process.env.COPERNICUS_CLIENT_SECRET;
  const authUrl = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
  const authResponse = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId || '',
      client_secret: clientSecret || '',
    }),
  });
  if (!authResponse.ok) throw new Error('Failed to authenticate for Catalog API');
  const { access_token } = await authResponse.json();
  const catalogRes = await fetch(`${catalogUrl}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!catalogRes.ok) throw new Error('Failed to fetch Catalog API');
  const catalogData = await catalogRes.json();
  return (catalogData.features || []).map((f: any) => ({
    id: f.id,
    datetime: f.properties.datetime,
    cloudCover: f.properties['eo:cloud_cover'],
    platform: f.properties.platform,
    instruments: f.properties.instruments,
    bbox: f.bbox,
  }));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { lat, lon, date, time, timezone, intervalMinutes, dim } = body;
    await appendLog(`[${new Date().toISOString()}] Copernicus Availability Request: lat=${lat}, lon=${lon}, date=${date}, time=${time}, timezone=${timezone}, dim=${dim}`);
    const scenes = await fetchAvailableScenes({ lat, lon, date, time, timezone, intervalMinutes, dateRangeDays: 7, dim });
    await appendLog(`[${new Date().toISOString()}] Copernicus Availability: scenes=${scenes.length}`);
    return NextResponse.json({ scenes });
  } catch (error: any) {
    await appendLog(`[${new Date().toISOString()}] Copernicus Availability Error: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
} 