import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const logFilePath = path.join(process.cwd(), 'logs', 'api-requests.log');
const ALLOWED_RESOLUTIONS = new Set([512, 1024, 2048]);

// Helper function to append log messages to the file
const appendLog = async (message: string) => {
  try {
    await fs.mkdir(path.dirname(logFilePath), { recursive: true });
    await fs.appendFile(logFilePath, message.replace(/[\r\n]+/g, ' ') + '\n');
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat') || '');
  const lon = parseFloat(searchParams.get('lon') || '');
  const acquisitionTime = (searchParams.get('acquisitionTime') || '').trim();
  const rawResolution = parseInt(searchParams.get('resolution') || '1024', 10);
  const resolution = ALLOWED_RESOLUTIONS.has(rawResolution) ? rawResolution : 1024;
  const rawDim = parseFloat(searchParams.get('dim') || '0.2');
  const dim = Number.isFinite(rawDim) ? Math.min(Math.max(rawDim, 0.01), 1.0) : 0.2;

  await appendLog(`[${new Date().toISOString()}] Copernicus API Request: lat=${lat}, lon=${lon}, acquisitionTime=${acquisitionTime}, resolution=${resolution}, dim=${dim}`);

  const parsedTime = Date.parse(acquisitionTime);
  if (!acquisitionTime || Number.isNaN(parsedTime) || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    const errorMessage = !acquisitionTime ? 'Missing required parameter: acquisitionTime' : 'Missing or invalid parameters';
    await appendLog(`[${new Date().toISOString()}] Error: ${errorMessage}`);
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }

  const clientId = process.env.COPERNICUS_CLIENT_ID;
  const clientSecret = process.env.COPERNICUS_CLIENT_SECRET;

  await appendLog(`[${new Date().toISOString()}] Copernicus API Key: ${clientId ? 'Provided' : 'Undefined'}`);

  if (!clientId || !clientSecret) {
    const errorMessage = 'Copernicus API credentials not configured in environment variables';
    await appendLog(`[${new Date().toISOString()}] Error: ${errorMessage}`);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }

  const authUrl = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
  const apiUrl = 'https://sh.dataspace.copernicus.eu/api/v1/process';

  try {
    // 1. Get Access Token
    const authResponse = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!authResponse.ok) {
      await appendLog(`[${new Date().toISOString()}] Copernicus Auth Error: status=${authResponse.status}`);
      return NextResponse.json({ error: 'Failed to authenticate with Copernicus API' }, { status: authResponse.status });
    }

    const authData = await authResponse.json();
    const accessToken = authData.access_token;
    await appendLog(`[${new Date().toISOString()}] Copernicus Access Token Obtained`);

    // 2. Calculate Bounding Box
    const halfDim = dim / 2;
    const bbox = [lon - halfDim, lat - halfDim, lon + halfDim, lat + halfDim];
    await appendLog(`[${new Date().toISOString()}] Bounding Box: ${bbox.join(', ')}`);

    // 3. Define Evalscript for True Color Image (Sentinel-2 L2A)
    const evalscript = `//VERSION=3
function setup() {
  return {
    input: ["B02", "B03", "B04"],
    output: { bands: 3 }
  };
}
function evaluatePixel(sample) {
  return [2.5 * sample.B04, 2.5 * sample.B03, 2.5 * sample.B02];
}
`;

    // 4. Determine time range (±1 minute window around scene acquisitionTime)
    const dateFrom = new Date(parsedTime - 60 * 1000).toISOString();
    const dateTo = new Date(parsedTime + 60 * 1000).toISOString();
    await appendLog(`[${new Date().toISOString()}] Time Interval: ${dateFrom} to ${dateTo}`);

    // 5. Construct Sentinel Hub Process API request body
    const requestBody = {
      input: {
        bounds: {
          bbox: bbox,
          properties: {
            crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
          },
        },
        data: [
          {
            type: 'sentinel-2-l2a',
            timeRange: {
              from: dateFrom,
              to: dateTo,
            },
          },
        ],
      },
      output: {
        width: resolution,
        height: resolution,
        responses: [
          {
            identifier: 'default',
            format: {
              type: 'image/png',
            },
          },
        ],
      },
      evalscript: evalscript,
    };

    // 6. Make request to Sentinel Hub Process API
    await appendLog(`[${new Date().toISOString()}] Sending request to Copernicus Process API`);
    const processResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!processResponse.ok) {
      await appendLog(`[${new Date().toISOString()}] Copernicus Process API Error: status=${processResponse.status}`);
      return NextResponse.json(
        { error: 'Failed to fetch image from Copernicus API' },
        { status: processResponse.status }
      );
    }

    await appendLog(`[${new Date().toISOString()}] Copernicus Process API Response Status: ${processResponse.status}`);
    // 7. Return the image data
    const imageBlob = await processResponse.blob();
    return new NextResponse(imageBlob, {
      headers: {
        'Content-Type': 'image/png',
        'x-image-metadata': acquisitionTime,
      },
    });
  } catch {
    await appendLog(`[${new Date().toISOString()}] Error in fetch-copernicus-image API route`);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
