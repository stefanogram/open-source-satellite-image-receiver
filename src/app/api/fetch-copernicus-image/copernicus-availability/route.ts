import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const logFilePath = path.join(process.cwd(), 'logs', 'api-requests.log');
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const appendLog = async (message: string) => {
  try {
    await fs.mkdir(path.dirname(logFilePath), { recursive: true });
    await fs.appendFile(logFilePath, message.replace(/[\r\n]+/g, ' ') + '\n');
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
};

interface CatalogFeature {
  id: string;
  properties: {
    datetime?: string;
    'eo:cloud_cover'?: number;
    platform?: string;
    instruments?: string[];
  };
  bbox?: number[];
}

// Helper to fetch available scenes from Copernicus Catalog API (±7 days)
async function fetchAvailableScenes({
  lat,
  lon,
  date,
  dateRangeDays = 7,
  dim = 0.2,
}: {
  lat: number;
  lon: number;
  date: string;
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
  if (!clientId || !clientSecret) {
    throw new Error('Missing Copernicus credentials');
  }
  const authUrl = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
  const authResponse = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!authResponse.ok) throw new Error('Failed to authenticate for Catalog API');
  const { access_token } = await authResponse.json();
  const catalogRes = await fetch(`${catalogUrl}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!catalogRes.ok) throw new Error('Failed to fetch Catalog API');
  const catalogData = await catalogRes.json();
  return ((catalogData.features || []) as CatalogFeature[]).map(f => ({
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
    const lat = Number(body?.lat);
    const lon = Number(body?.lon);
    const date = typeof body?.date === 'string' ? body.date.trim() : '';
    const time = typeof body?.time === 'string' ? body.time.trim() : '';
    const timezone = typeof body?.timezone === 'string' ? body.timezone.trim() : '';
    const rawDim = Number(body?.dim ?? 0.2);
    const dim = Number.isFinite(rawDim) ? Math.min(Math.max(rawDim, 0.01), 1.0) : 0.2;

    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180 || !DATE_REGEX.test(date)) {
      return NextResponse.json({ error: 'Invalid coordinates or date format (YYYY-MM-DD required).' }, { status: 400 });
    }

    await appendLog(`[${new Date().toISOString()}] Copernicus Availability Request: lat=${lat}, lon=${lon}, date=${date}, time=${time}, timezone=${timezone}, dim=${dim}`);
    const scenes = await fetchAvailableScenes({ lat, lon, date, dateRangeDays: 7, dim });
    await appendLog(`[${new Date().toISOString()}] Copernicus Availability: scenes=${scenes.length}`);
    return NextResponse.json({ scenes });
  } catch {
    await appendLog(`[${new Date().toISOString()}] Copernicus Availability Error`);
    return NextResponse.json({ error: 'Failed to check Copernicus availability.' }, { status: 500 });
  }
}
