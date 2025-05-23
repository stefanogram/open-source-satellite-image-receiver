import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const logFilePath = path.join(process.cwd(), 'logs', 'api-requests.log');

// Helper function to append log messages to the file
const appendLog = async (message: string) => {
  try {
    await fs.appendFile(logFilePath, message + '\n');
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
};

// Add a helper to fetch available scenes from the Copernicus Catalog API
async function fetchAvailableScenes({ lat, lon, date, time, timezone, intervalMinutes = 1440, dateRangeDays = 7 }: {
  lat: number;
  lon: number;
  date: string;
  time: string;
  timezone: string;
  intervalMinutes?: number;
  dateRangeDays?: number;
}) {
  // Calculate BBOX (small area around point)
  const dim = 0.2;
  const halfDim = dim / 2;
  const bbox = [lon - halfDim, lat - halfDim, lon + halfDim, lat + halfDim];

  // Calculate time interval (±dateRangeDays)
  const dateObj = new Date(date);
  const from = new Date(dateObj.getTime() - dateRangeDays * 24 * 60 * 60 * 1000);
  const to = new Date(dateObj.getTime() + dateRangeDays * 24 * 60 * 60 * 1000);
  const dateFrom = from.toISOString();
  const dateTo = to.toISOString();

  // Catalog API endpoint
  const catalogUrl = 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/collections/sentinel-2-l2a/items';
  const params = new URLSearchParams({
    bbox: bbox.join(','),
    datetime: `${dateFrom}/${dateTo}`,
    limit: '20',
  });

  // Get access token
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

  // Query Catalog API
  const catalogRes = await fetch(`${catalogUrl}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!catalogRes.ok) throw new Error('Failed to fetch Catalog API');
  const catalogData = await catalogRes.json();
  // Return scenes with acquisition time and cloud cover
  return (catalogData.features || []).map((f: any) => ({
    id: f.id,
    datetime: f.properties.datetime,
    cloudCover: f.properties['eo:cloud_cover'],
    platform: f.properties.platform,
    instruments: f.properties.instruments,
    bbox: f.bbox,
  }));
}

// Add a new API route for /api/copernicus-availability
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.endsWith('/copernicus-availability')) {
    try {
      const body = await request.json();
      const { lat, lon, date, time, timezone, intervalMinutes } = body;
      const scenes = await fetchAvailableScenes({ lat, lon, date, time, timezone, intervalMinutes, dateRangeDays: 7 });
      await appendLog(`[${new Date().toISOString()}] Copernicus Availability: lat=${lat}, lon=${lon}, date=${date}, time=${time}, timezone=${timezone}, scenes=${scenes.length}`);
      return NextResponse.json({ scenes });
    } catch (error: any) {
      await appendLog(`[${new Date().toISOString()}] Copernicus Availability Error: ${error.message}`);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  // Fallback to GET for image fetch
  return GET(request);
}

// Refactor GET to require exact acquisition time
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat') || '0');
  const lon = parseFloat(searchParams.get('lon') || '0');
  const acquisitionTime = searchParams.get('acquisitionTime');
  const resolution = parseInt(searchParams.get('resolution') || '1024', 10);
  const dim = parseFloat(searchParams.get('dim') || '0.2');

  await appendLog(`[${new Date().toISOString()}] Copernicus API Request: lat=${lat}, lon=${lon}, acquisitionTime=${acquisitionTime}, resolution=${resolution}, dim=${dim}`);

  if (!acquisitionTime || isNaN(lat) || isNaN(lon) || isNaN(resolution)) {
    const errorMessage = !acquisitionTime ? 'Missing required parameter: acquisitionTime' : 'Missing or invalid parameters';
    await appendLog(`[${new Date().toISOString()}] Error: ${errorMessage}`);
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }

  const clientId = process.env.COPERNICUS_CLIENT_ID;
  const clientSecret = process.env.COPERNICUS_CLIENT_SECRET;

  // console.log('COPERNICUS_CLIENT_ID:', clientId ? 'Provided' : 'Undefined');
  // console.log('COPERNICUS_CLIENT_SECRET:', clientSecret ? 'Provided' : 'Undefined');

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
      const errorText = await authResponse.text();
       await appendLog(`[${new Date().toISOString()}] Copernicus Auth Error: ${authResponse.status} - ${errorText}`);
      console.error('Failed to get Copernicus access token:', authResponse.status, errorText);
      return NextResponse.json({ error: `Failed to authenticate with Copernicus API: ${authResponse.statusText}` }, { status: authResponse.status });
    }

    const authData = await authResponse.json();
    const accessToken = authData.access_token;
    await appendLog(`[${new Date().toISOString()}] Copernicus Access Token Obtained`);

    // 2. Calculate Bounding Box (simple approximation)
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

    // 4. Determine time range (fetch image for the specified date and time interval)
    const dateFrom = acquisitionTime;
    const dateTo = acquisitionTime;
    const timeInterval = [dateFrom, dateTo];
    await appendLog(`[${new Date().toISOString()}] Time Interval: ${timeInterval.join(' to ')}`);

    // Calculate approximate width and height in pixels based on dimension and target resolution (e.g., 1000m/pixel)
    const targetResolutionMetersPerPixel = 1000;
    // Rough conversion from degrees to meters at latitude ~38 degrees (Athens)
    const metersPerDegreeLat = 111000; // Approximate
    const metersPerDegreeLon = 88000; // Approximate at ~38 degrees

    const widthInMeters = 0.2 * metersPerDegreeLon;
    const heightInMeters = 0.2 * metersPerDegreeLat;

    const calculatedWidth = Math.round(widthInMeters / targetResolutionMetersPerPixel);
    const calculatedHeight = Math.round(heightInMeters / targetResolutionMetersPerPixel);

    // Ensure a minimum size to avoid issues with very small dimensions
    const minDimension = 256; // Minimum pixels
    const outputWidth = Math.max(calculatedWidth, minDimension);
    const outputHeight = Math.max(calculatedHeight, minDimension);

    await appendLog(`[${new Date().toISOString()}] Calculated Output Dimensions: width=${outputWidth}, height=${outputHeight}`);

    // 5. Construct Sentinel Hub Process API request body
    const requestBody = {
      input: {
        bounds: {
          bbox: bbox,
          properties: {
             crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" // WGS84
          }
        },
        data: [
          {
            type: "sentinel-2-l2a",
            timeRange: {
              from: timeInterval[0],
              to: timeInterval[1]
            },
             // Optional: Filter by cloud coverage
             dataFilter: {
                 maxCloudCoverage: 20 // Adjust as needed
             }
          }
        ],
      },
      output: {
        width: resolution,
        height: resolution,
        responses: [
          {
            identifier: "default",
            format: {
              type: "image/png"
            }
          }
        ]
      },
      evalscript: evalscript,
      // Optional: Choose mosaicking order if multiple images in time range
      // mosaickingOrder: "leastCC" // Use least cloudy image
    };

     // 6. Make request to Sentinel Hub Process API
     await appendLog(`[${new Date().toISOString()}] Sending request to Copernicus Process API`);
    const processResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!processResponse.ok) {
       const errorText = await processResponse.text();
        await appendLog(`[${new Date().toISOString()}] Copernicus Process API Error: ${processResponse.status} - ${errorText}`);
       console.error('Failed to fetch image from Copernicus Process API:', processResponse.status, errorText);
       // Attempt to parse JSON error if available
       try {
           const errorJson = JSON.parse(errorText);
           return NextResponse.json({ error: 'Copernicus API Error', details: errorJson }, { status: processResponse.status });
       } catch (e) {
           return NextResponse.json({ error: `Failed to fetch image from Copernicus API: ${processResponse.statusText}`, details: errorText }, { status: processResponse.status });
       }
    }

    await appendLog(`[${new Date().toISOString()}] Copernicus Process API Response Status: ${processResponse.status}`);
    // 7. Return the image data
    const imageBlob = await processResponse.blob();
    return new NextResponse(imageBlob, {
      headers: {
        'Content-Type': 'image/png',
      },
    });

  } catch (error: any) {
    await appendLog(`[${new Date().toISOString()}] Error in fetch-copernicus-image API route: ${error.message}`);
    console.error('Error in fetch-copernicus-image API route:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 