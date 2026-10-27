import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { subDays, addDays, formatISO } from 'date-fns';

const NASA_API_KEY = process.env.NASA_API_KEY;
const logFilePath = path.join(process.cwd(), 'logs', 'api-requests.log');
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Helper function to append log messages to the file
const appendLog = async (message: string) => {
  try {
    await fs.mkdir(path.dirname(logFilePath), { recursive: true });
    await fs.appendFile(logFilePath, message.replace(/[\r\n]+/g, ' ') + '\n');
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
};

function redactUrl(url: string) {
  return url.replace(/api_key=[^&]+/gi, 'api_key=[REDACTED]');
}

function truncate(str: string, n = 500) {
  return str.length > n ? str.slice(0, n) + '... [truncated]' : str;
}

export async function GET(request: Request) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat') || '');
  const lon = parseFloat(searchParams.get('lon') || '');
  const date = (searchParams.get('date') || '').trim();
  const resolution = (searchParams.get('resolution') || '').trim();
  const rawDim = parseFloat(searchParams.get('dim') || '0.2');
  const dim = Number.isFinite(rawDim) ? Math.min(Math.max(rawDim, 0.01), 1.0) : 0.2;

  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180 || !DATE_REGEX.test(date)) {
    return NextResponse.json({ error: 'Invalid coordinates or date format (YYYY-MM-DD required).' }, { status: 400 });
  }

  await appendLog(`[${new Date().toISOString()}] NASA API REQUEST: lat=${lat}, lon=${lon}, date=${date}, resolution=${resolution}, dim=${dim}`);
  await appendLog(`[${new Date().toISOString()}] NASA API KEY: ${NASA_API_KEY ? 'Provided' : 'Missing/Undefined'}`);

  if (!NASA_API_KEY) {
    return NextResponse.json({ error: 'NASA API key is not configured on the server.' }, { status: 500 });
  }

  // Query assets API for the range (do NOT send resolution)
  const begin = date;
  const end = date;
  const apiKey = NASA_API_KEY;
  const assetsUrl = `https://api.nasa.gov/planetary/earth/assets?lon=${lon}&lat=${lat}&begin=${begin}&end=${end}&dim=${dim}&api_key=${encodeURIComponent(apiKey)}`;
  await appendLog(`[${new Date().toISOString()}] NASA Assets URL: ${redactUrl(assetsUrl)}`);
  let assetsRes, assetsBody;
  let assetsError = false;
  const assetsStart = Date.now();
  try {
    assetsRes = await fetch(assetsUrl);
    assetsBody = await assetsRes.text();
    await appendLog(`[${new Date().toISOString()}] NASA Assets Response: status=${assetsRes.status}, body=${truncate(assetsBody)}`);
    await appendLog(`[${new Date().toISOString()}] NASA Assets Request Time: ${Date.now() - assetsStart}ms`);
    if (!assetsRes.ok) {
      assetsError = true;
    }
  } catch {
    await appendLog(`[${new Date().toISOString()}] NASA Assets Fetch Error`);
    assetsError = true;
  }

  let availableDates: string[] = [];
  let closestDate: string | null = null;
  if (!assetsError) {
    try {
      const assetsJson = JSON.parse(assetsBody || '{}');
      availableDates = (assetsJson.results || []).map((r: { date: string }) => r.date);
      closestDate = availableDates.length > 0 ? availableDates[0] : null;
      await appendLog(`[${new Date().toISOString()}] NASA Available Dates: ${availableDates.join(', ')}`);
    } catch {
      await appendLog(`[${new Date().toISOString()}] NASA Assets JSON Parse Error`);
      assetsError = true;
    }
  }

  // Calculate ±7 days range for assets query
  const dateObj = new Date(date);
  const begin7 = formatISO(subDays(dateObj, 7), { representation: 'date' });
  const end7 = formatISO(addDays(dateObj, 7), { representation: 'date' });
  const assetsUrl7 = `https://api.nasa.gov/planetary/earth/assets?lon=${lon}&lat=${lat}&begin=${begin7}&end=${end7}&dim=${dim}&api_key=${encodeURIComponent(apiKey)}`;
  await appendLog(`[${new Date().toISOString()}] NASA Assets ±7 URL: ${redactUrl(assetsUrl7)}`);
  let assetsRes7, assetsBody7;
  let availableDates7: string[] = [];
  const assets7Start = Date.now();
  try {
    assetsRes7 = await fetch(assetsUrl7);
    assetsBody7 = await assetsRes7.text();
    await appendLog(`[${new Date().toISOString()}] NASA Assets ±7 Response: status=${assetsRes7.status}, body=${truncate(assetsBody7)}`);
    await appendLog(`[${new Date().toISOString()}] NASA Assets ±7 Request Time: ${Date.now() - assets7Start}ms`);
    if (assetsRes7.ok) {
      const assetsJson7 = JSON.parse(assetsBody7 || '{}');
      availableDates7 = (assetsJson7.results || []).map((r: { date: string }) => r.date);
    }
  } catch {
    await appendLog(`[${new Date().toISOString()}] NASA Assets ±7 Fetch Error`);
  }

  // If the requested date is available, fetch the image
  if (!assetsError && availableDates.includes(date)) {
    const imageUrl = `https://api.nasa.gov/planetary/earth/imagery?lon=${lon}&lat=${lat}&date=${date}&dim=${dim}&api_key=${encodeURIComponent(apiKey)}`;
    await appendLog(`[${new Date().toISOString()}] NASA Image URL: ${redactUrl(imageUrl)}`);
    let imageRes;
    const imageStart = Date.now();
    try {
      imageRes = await fetch(imageUrl);
      await appendLog(`[${new Date().toISOString()}] NASA Image Response: status=${imageRes.status}`);
      await appendLog(`[${new Date().toISOString()}] NASA Image Request Time: ${Date.now() - imageStart}ms`);
      if (!imageRes.ok) {
        await appendLog(`[${new Date().toISOString()}] NASA Image Error: ${imageRes.status}`);
        return NextResponse.json({ error: 'Failed to fetch NASA image.' }, { status: imageRes.status });
      }
      const imageBlob = await imageRes.blob();
      await appendLog(`[${new Date().toISOString()}] NASA Image Fetch Success: ${imageBlob.size} bytes`);
      await appendLog(`[${new Date().toISOString()}] NASA API Total Time: ${Date.now() - startTime}ms`);
      return new NextResponse(imageBlob, {
        headers: {
          'Content-Type': 'image/png',
          'x-image-metadata': date,
          'x-nasa-available-dates': availableDates7.join(','),
        },
      });
    } catch {
      await appendLog(`[${new Date().toISOString()}] NASA Image Fetch Error`);
      return NextResponse.json({ error: 'Failed to fetch NASA image.' }, { status: 500 });
    }
  }

  // Fallback: If /assets errored or no available dates, try /imagery directly
  await appendLog(`[${new Date().toISOString()}] NASA Fallback: Trying /imagery endpoint directly for date=${date}`);
  const fallbackImageUrl = `https://api.nasa.gov/planetary/earth/imagery?lon=${lon}&lat=${lat}&date=${date}&dim=${dim}&api_key=${encodeURIComponent(apiKey)}`;
  let fallbackImageRes;
  const fallbackStart = Date.now();
  try {
    fallbackImageRes = await fetch(fallbackImageUrl);
    await appendLog(`[${new Date().toISOString()}] NASA Fallback Image Response: status=${fallbackImageRes.status}`);
    await appendLog(`[${new Date().toISOString()}] NASA Fallback Image Request Time: ${Date.now() - fallbackStart}ms`);
    if (fallbackImageRes.ok) {
      const imageBlob = await fallbackImageRes.blob();
      await appendLog(`[${new Date().toISOString()}] NASA Fallback Image Fetch Success: ${imageBlob.size} bytes`);
      await appendLog(`[${new Date().toISOString()}] NASA API Total Time: ${Date.now() - startTime}ms`);
      return new NextResponse(imageBlob, {
        headers: {
          'Content-Type': 'image/png',
          'x-image-metadata': closestDate || date,
          'x-nasa-available-dates': availableDates7.join(','),
        },
      });
    } else {
      await appendLog(`[${new Date().toISOString()}] NASA Fallback Image Error: ${fallbackImageRes.status}`);
    }
  } catch {
    await appendLog(`[${new Date().toISOString()}] NASA Fallback Image Fetch Error`);
  }

  // If not, return the list and closest date (if any)
  await appendLog(`[${new Date().toISOString()}] NASA No imagery for requested date. Available dates: ${availableDates7.join(', ')}`);
  await appendLog(`[${new Date().toISOString()}] NASA API Total Time: ${Date.now() - startTime}ms`);
  return NextResponse.json({
    error: 'No imagery available for this date/location.',
    availableDates: availableDates7,
    closestDate,
  }, { status: 404 });
}
