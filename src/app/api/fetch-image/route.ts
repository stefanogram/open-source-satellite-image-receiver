import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { parseISO, subDays, addDays, formatISO } from 'date-fns';

const NASA_API_KEY = process.env.NASA_API_KEY;
const logFilePath = path.join(process.cwd(), 'logs', 'api-requests.log');

// Helper function to append log messages to the file
const appendLog = async (message: string) => {
  try {
    await fs.appendFile(logFilePath, message + '\n');
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
};

function truncate(str: string, n = 500) {
  return str.length > n ? str.slice(0, n) + '... [truncated]' : str;
}

export async function GET(request: Request) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat') || '0');
  const lon = parseFloat(searchParams.get('lon') || '0');
  const date = searchParams.get('date') || '';
  const resolution = searchParams.get('resolution') || '';
  const dim = parseFloat(searchParams.get('dim') || '0.2');
  await appendLog(`[${new Date().toISOString()}] NASA API REQUEST: lat=${lat}, lon=${lon}, date=${date}, resolution=${resolution}, dim=${dim}`);
  await appendLog(`[${new Date().toISOString()}] NASA API KEY: ${NASA_API_KEY ? 'Provided' : 'Missing/Undefined'}`);

  // Query assets API for the range (do NOT send resolution)
  const begin = date;
  const end = date;
  const apiKey = NASA_API_KEY;
  const assetsUrl = `https://api.nasa.gov/planetary/earth/assets?lon=${lon}&lat=${lat}&begin=${begin}&end=${end}&dim=${dim}&api_key=${apiKey}`;
  await appendLog(`[${new Date().toISOString()}] NASA Assets URL: ${assetsUrl}`);
  let assetsRes, assetsBody;
  let assetsError = false;
  let assetsStart = Date.now();
  try {
    assetsRes = await fetch(assetsUrl);
    assetsBody = await assetsRes.text();
    await appendLog(`[${new Date().toISOString()}] NASA Assets Response: status=${assetsRes.status}, body=${truncate(assetsBody)}`);
    await appendLog(`[${new Date().toISOString()}] NASA Assets Request Time: ${Date.now() - assetsStart}ms`);
    if (!assetsRes.ok) {
      assetsError = true;
    }
  } catch (err) {
    await appendLog(`[${new Date().toISOString()}] NASA Assets Fetch Error: ${err}`);
    assetsError = true;
  }

  let availableDates = [];
  let closestDate = null;
  if (!assetsError) {
    try {
      const assetsJson = JSON.parse(assetsBody || '{}');
      availableDates = (assetsJson.results || []).map((r: any) => r.date);
      closestDate = availableDates.length > 0 ? availableDates[0] : null;
      await appendLog(`[${new Date().toISOString()}] NASA Available Dates: ${availableDates.join(', ')}`);
    } catch (err) {
      await appendLog(`[${new Date().toISOString()}] NASA Assets JSON Parse Error: ${err}`);
      assetsError = true;
    }
  }

  // Calculate ±7 days range for assets query
  const dateObj = new Date(date);
  const begin7 = formatISO(subDays(dateObj, 7), { representation: 'date' });
  const end7 = formatISO(addDays(dateObj, 7), { representation: 'date' });
  const assetsUrl7 = `https://api.nasa.gov/planetary/earth/assets?lon=${lon}&lat=${lat}&begin=${begin7}&end=${end7}&dim=${dim}&api_key=${apiKey}`;
  await appendLog(`[${new Date().toISOString()}] NASA Assets ±7 URL: ${assetsUrl7}`);
  let assetsRes7, assetsBody7, availableDates7 = [];
  let assets7Start = Date.now();
  try {
    assetsRes7 = await fetch(assetsUrl7);
    assetsBody7 = await assetsRes7.text();
    await appendLog(`[${new Date().toISOString()}] NASA Assets ±7 Response: status=${assetsRes7.status}, body=${truncate(assetsBody7)}`);
    await appendLog(`[${new Date().toISOString()}] NASA Assets ±7 Request Time: ${Date.now() - assets7Start}ms`);
    if (assetsRes7.ok) {
      const assetsJson7 = JSON.parse(assetsBody7 || '{}');
      availableDates7 = (assetsJson7.results || []).map((r: any) => r.date);
    }
  } catch (err) {
    await appendLog(`[${new Date().toISOString()}] NASA Assets ±7 Fetch Error: ${err}`);
  }

  // If the requested date is available, fetch the image
  if (!assetsError && availableDates.includes(date)) {
    const imageUrl = `https://api.nasa.gov/planetary/earth/imagery?lon=${lon}&lat=${lat}&date=${date}&dim=${dim}&api_key=${apiKey}`;
    await appendLog(`[${new Date().toISOString()}] NASA Image URL: ${imageUrl}`);
    let imageRes;
    let imageStart = Date.now();
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
    } catch (err) {
      await appendLog(`[${new Date().toISOString()}] NASA Image Fetch Error: ${err}`);
      return NextResponse.json({ error: 'Failed to fetch NASA image.' }, { status: 500 });
    }
  }

  // Fallback: If /assets errored or no available dates, try /imagery directly
  await appendLog(`[${new Date().toISOString()}] NASA Fallback: Trying /imagery endpoint directly for date=${date}`);
  const fallbackImageUrl = `https://api.nasa.gov/planetary/earth/imagery?lon=${lon}&lat=${lat}&date=${date}&dim=${dim}&api_key=${apiKey}`;
  let fallbackImageRes;
  let fallbackStart = Date.now();
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
  } catch (err) {
    await appendLog(`[${new Date().toISOString()}] NASA Fallback Image Fetch Error: ${err}`);
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