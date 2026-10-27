import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import sharp from 'sharp';

const logFilePath = path.join(process.cwd(), 'logs', 'api-requests.log');
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_RESOLUTIONS = new Set([256, 512, 1024, 2048]);

// Helper function to append log messages to the file
const appendLog = async (message: string) => {
  try {
    await fs.mkdir(path.dirname(logFilePath), { recursive: true });
    await fs.appendFile(logFilePath, message.replace(/[\r\n]+/g, ' ') + '\n');
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
};

// GIBS Layer Catalog (expand as needed)
const GIBS_LAYERS = [
  {
    label: 'MODIS Terra True Color',
    value: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    description: 'Daily true color imagery from MODIS Terra (250m, 2000-present)',
    timeRange: { start: '2000-02-24', end: null },
  },
  {
    label: 'MODIS Aqua True Color',
    value: 'MODIS_Aqua_CorrectedReflectance_TrueColor',
    description: 'Daily true color imagery from MODIS Aqua (250m, 2002-present)',
    timeRange: { start: '2002-07-04', end: null },
  },
  {
    label: 'VIIRS SNPP True Color',
    value: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    description: 'Daily true color imagery from VIIRS Suomi NPP (375m, 2012-present)',
    timeRange: { start: '2012-01-20', end: null },
  },
];

const ALLOWED_LAYERS = new Set(GIBS_LAYERS.map(l => l.value));

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const layerParam = searchParams.get('layer');

  // 1. List available layers
  if (action === 'layers') {
    await appendLog(`[${new Date().toISOString()}] GIBS API ACTION: layers`);
    return NextResponse.json({ layers: GIBS_LAYERS });
  }

  // 2. Layer metadata
  if (action === 'layer-metadata') {
    await appendLog(`[${new Date().toISOString()}] GIBS API ACTION: layer-metadata, layer=${layerParam}`);
    const meta = GIBS_LAYERS.find(l => l.value === layerParam);
    if (!meta) {
      await appendLog(`[${new Date().toISOString()}] GIBS API ERROR: Layer not found`);
      return NextResponse.json({ error: 'Layer not found' }, { status: 404 });
    }
    return NextResponse.json({ metadata: meta });
  }

  // 3. Available dates
  if (action === 'available-dates' && layerParam) {
    if (!ALLOWED_LAYERS.has(layerParam)) {
      return NextResponse.json({ error: 'Invalid GIBS layer' }, { status: 400 });
    }
    const capabilitiesUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layerParam}/default/GoogleMapsCompatible_Level9/1.0.0/WMTSCapabilities.xml`;
    await appendLog(`[${new Date().toISOString()}] GIBS AVAILABLE DATES REQUEST: layer=${layerParam}, url=${capabilitiesUrl}`);
    try {
      const res = await fetch(capabilitiesUrl);
      const xml = await res.text();
      const parsed = await parseStringPromise(xml);
      const layers = parsed?.Capabilities?.Contents?.[0]?.Layer || [];
      let dates: string[] = [];
      for (const lyr of layers) {
        if (lyr.Identifier?.[0] === layerParam && lyr.Dimension) {
          for (const dim of lyr.Dimension) {
            if (dim.$?.name === 'Time' && typeof dim._ === 'string') {
              dates = dim._.split(',');
              break;
            }
          }
        }
      }
      await appendLog(`[${new Date().toISOString()}] GIBS AVAILABLE DATES: layer=${layerParam}, count=${dates.length}`);
      return NextResponse.json({ availableDates: dates });
    } catch {
      await appendLog(`[${new Date().toISOString()}] GIBS AVAILABLE DATES ERROR`);
      return NextResponse.json({ error: 'Failed to fetch available dates.' }, { status: 500 });
    }
  }

  // 4. Default: tile fetch or high-res image
  const defaultLayer = layerParam || 'MODIS_Terra_CorrectedReflectance_TrueColor';
  if (!ALLOWED_LAYERS.has(defaultLayer)) {
    return NextResponse.json({ error: 'Invalid GIBS layer' }, { status: 400 });
  }

  const date = (searchParams.get('date') || new Date().toISOString().slice(0, 10)).trim();
  if (!DATE_REGEX.test(date)) {
    return NextResponse.json({ error: 'Invalid date format (YYYY-MM-DD required)' }, { status: 400 });
  }

  const zParam = searchParams.get('z');
  const xParam = searchParams.get('x');
  const yParam = searchParams.get('y');
  if (zParam === null || xParam === null || yParam === null) {
    await appendLog(`[${new Date().toISOString()}] GIBS API ERROR: Missing tile coordinates (z, x, y)`);
    return NextResponse.json({ error: 'Missing tile coordinates (z, x, y)' }, { status: 400 });
  }

  const z = parseInt(zParam, 10);
  const x = parseInt(xParam, 10);
  const y = parseInt(yParam, 10);
  const maxTileIndex = Math.pow(2, z);
  if (!Number.isInteger(z) || z < 0 || z > 9 || !Number.isInteger(x) || x < 0 || x >= maxTileIndex || !Number.isInteger(y) || y < 0 || y >= maxTileIndex) {
    return NextResponse.json({ error: 'Tile coordinates out of valid range' }, { status: 400 });
  }

  const rawResolution = parseInt(searchParams.get('resolution') || '256', 10);
  const resolution = ALLOWED_RESOLUTIONS.has(rawResolution) ? rawResolution : 256;

  await appendLog(`[${new Date().toISOString()}] GIBS API REQUEST: layer=${defaultLayer}, date=${date}, z=${z}, x=${x}, y=${y}, resolution=${resolution}`);

  // If resolution > 256, stitch tiles
  if (resolution > 256) {
    const tilesPerSide = Math.ceil(resolution / 256);
    const half = Math.floor(tilesPerSide / 2);
    const startX = x - half;
    const startY = y - half;
    const tilePromises: Promise<ArrayBuffer | null>[] = [];
    for (let dy = 0; dy < tilesPerSide; dy++) {
      for (let dx = 0; dx < tilesPerSide; dx++) {
        const tileX = Math.min(Math.max(startX + dx, 0), maxTileIndex - 1);
        const tileY = Math.min(Math.max(startY + dy, 0), maxTileIndex - 1);
        const tileUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${defaultLayer}/default/${date}/GoogleMapsCompatible_Level9/${z}/${tileY}/${tileX}.jpg`;
        tilePromises.push(fetch(tileUrl).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
      }
    }
    try {
      const tileBuffers = await Promise.all(tilePromises);
      const blankTile = await sharp({
        create: { width: 256, height: 256, channels: 3, background: { r: 255, g: 255, b: 255 } },
      }).jpeg().toBuffer();

      const compositeInputs: { input: Buffer; left: number; top: number }[] = [];
      let idx = 0;
      for (let dy = 0; dy < tilesPerSide; dy++) {
        for (let dx = 0; dx < tilesPerSide; dx++) {
          const arrBuf = tileBuffers[idx++];
          compositeInputs.push({
            input: arrBuf ? Buffer.from(arrBuf) : blankTile,
            left: dx * 256,
            top: dy * 256,
          });
        }
      }

      const finalImg = await sharp({
        create: {
          width: 256 * tilesPerSide,
          height: 256 * tilesPerSide,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .composite(compositeInputs)
        .resize(resolution, resolution)
        .jpeg()
        .toBuffer();

      await appendLog(`[${new Date().toISOString()}] GIBS STITCHED IMAGE: ${resolution}x${resolution}`);
      return new NextResponse(new Uint8Array(finalImg), {
        headers: {
          'Content-Type': 'image/jpeg',
          'x-gibs-layer': defaultLayer,
          'x-gibs-date': date,
        },
      });
    } catch {
      await appendLog(`[${new Date().toISOString()}] GIBS STITCH ERROR`);
      return NextResponse.json({ error: 'Failed to stitch GIBS tiles.' }, { status: 500 });
    }
  }

  // Otherwise, fetch a single tile
  const gibsUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${defaultLayer}/default/${date}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`;
  await appendLog(`[${new Date().toISOString()}] GIBS TILE URL: ${gibsUrl}`);

  try {
    const tileRes = await fetch(gibsUrl);
    if (!tileRes.ok) {
      await appendLog(`[${new Date().toISOString()}] GIBS TILE ERROR: status=${tileRes.status}`);
      return NextResponse.json({ error: 'Failed to fetch GIBS tile.' }, { status: tileRes.status });
    }
    const tileBuffer = await tileRes.arrayBuffer();
    return new NextResponse(Buffer.from(tileBuffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        'x-gibs-layer': defaultLayer,
        'x-gibs-date': date,
      },
    });
  } catch {
    await appendLog(`[${new Date().toISOString()}] GIBS TILE FETCH ERROR`);
    return NextResponse.json({ error: 'Error fetching GIBS tile.' }, { status: 500 });
  }
}
