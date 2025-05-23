import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import sharp from 'sharp';

const logFilePath = path.join(process.cwd(), 'logs', 'api-requests.log');

// Helper function to append log messages to the file
const appendLog = async (message: string) => {
  try {
    await fs.appendFile(logFilePath, message + '\n');
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
  // Add more layers as needed
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const layer = searchParams.get('layer');

  // 1. List available layers
  if (action === 'layers') {
    await appendLog(`[${new Date().toISOString()}] GIBS API ACTION: layers`);
    return NextResponse.json({ layers: GIBS_LAYERS });
  }

  // 2. Layer metadata
  if (action === 'layer-metadata') {
    await appendLog(`[${new Date().toISOString()}] GIBS API ACTION: layer-metadata, layer=${layer}`);
    const meta = GIBS_LAYERS.find(l => l.value === layer);
    if (!meta) {
      await appendLog(`[${new Date().toISOString()}] GIBS API ERROR: Layer not found: ${layer}`);
      return NextResponse.json({ error: 'Layer not found' }, { status: 404 });
    }
    return NextResponse.json({ metadata: meta });
  }

  // 3. Available dates
  if (action === 'available-dates' && layer) {
    const capabilitiesUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/GoogleMapsCompatible_Level9/1.0.0/WMTSCapabilities.xml`;
    await appendLog(`[${new Date().toISOString()}] GIBS AVAILABLE DATES REQUEST: layer=${layer}, url=${capabilitiesUrl}`);
    try {
      const res = await fetch(capabilitiesUrl);
      const xml = await res.text();
      const parsed = await parseStringPromise(xml);
      // Find the Dimension with name="Time"
      const layers = parsed.Capabilities.Contents[0].Layer;
      let dates: string[] = [];
      for (const lyr of layers) {
        if (lyr.Identifier[0] === layer && lyr.Dimension) {
          for (const dim of lyr.Dimension) {
            if (dim.$.name === 'Time') {
              dates = dim._.split(',');
              break;
            }
          }
        }
      }
      await appendLog(`[${new Date().toISOString()}] GIBS AVAILABLE DATES: layer=${layer}, count=${dates.length}`);
      return NextResponse.json({ availableDates: dates });
    } catch (err) {
      await appendLog(`[${new Date().toISOString()}] GIBS AVAILABLE DATES ERROR: ${err}`);
      return NextResponse.json({ error: 'Failed to fetch available dates.' }, { status: 500 });
    }
  }

  // 4. Default: tile fetch or high-res image
  const defaultLayer = searchParams.get('layer') || 'MODIS_Terra_CorrectedReflectance_TrueColor';
  const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const z = parseInt(searchParams.get('z') || '8', 10);
  const x = parseInt(searchParams.get('x') || '0', 10);
  const y = parseInt(searchParams.get('y') || '0', 10);
  const resolution = parseInt(searchParams.get('resolution') || '256', 10);

  await appendLog(`[${new Date().toISOString()}] GIBS API REQUEST: layer=${defaultLayer}, date=${date}, z=${z}, x=${x}, y=${y}, resolution=${resolution}`);

  if (!z && !x && !y) {
    await appendLog(`[${new Date().toISOString()}] GIBS API ERROR: Missing tile coordinates (z, x, y)`);
    return NextResponse.json({ error: 'Missing tile coordinates (z, x, y)' }, { status: 400 });
  }

  // If resolution > 256, stitch tiles
  if (resolution > 256) {
    // Calculate how many tiles needed to cover the requested resolution
    const tilesPerSide = Math.ceil(resolution / 256);
    const half = Math.floor(tilesPerSide / 2);
    const startX = x - half;
    const startY = y - half;
    const tilePromises = [];
    for (let dy = 0; dy < tilesPerSide; dy++) {
      for (let dx = 0; dx < tilesPerSide; dx++) {
        const tileX = startX + dx;
        const tileY = startY + dy;
        const tileUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${defaultLayer}/default/${date}/GoogleMapsCompatible_Level9/${z}/${tileY}/${tileX}.jpg`;
        tilePromises.push(fetch(tileUrl).then(r => r.ok ? r.arrayBuffer() : null));
      }
    }
    try {
      const tileBuffers = await Promise.all(tilePromises);
      // Build the composite image
      const images = [];
      let idx = 0;
      for (let dy = 0; dy < tilesPerSide; dy++) {
        const row = [];
        for (let dx = 0; dx < tilesPerSide; dx++) {
          const buf = tileBuffers[idx++] ? Buffer.from(tileBuffers[idx - 1]) : Buffer.alloc(256 * 256 * 3, 0xff);
          row.push(buf);
        }
        images.push(row);
      }
      // Stitch rows
      let stitchedRows = [];
      for (const row of images) {
        const rowImg = await sharp({ create: { width: 256 * tilesPerSide, height: 256, channels: 3, background: { r: 255, g: 255, b: 255 } } })
          .composite(row.map((buf, i) => ({ input: buf, left: i * 256, top: 0 })))
          .jpeg()
          .toBuffer();
        stitchedRows.push(rowImg);
      }
      // Stitch columns
      const finalImg = await sharp({ create: { width: 256 * tilesPerSide, height: 256 * tilesPerSide, channels: 3, background: { r: 255, g: 255, b: 255 } } })
        .composite(stitchedRows.map((buf, i) => ({ input: buf, left: 0, top: i * 256 })))
        .resize(resolution, resolution)
        .jpeg()
        .toBuffer();
      await appendLog(`[${new Date().toISOString()}] GIBS STITCHED IMAGE: ${resolution}x${resolution}`);
      return new NextResponse(finalImg, {
        headers: {
          'Content-Type': 'image/jpeg',
          'x-gibs-layer': defaultLayer,
          'x-gibs-date': date,
        },
      });
    } catch (err) {
      await appendLog(`[${new Date().toISOString()}] GIBS STITCH ERROR: ${err}`);
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
  } catch (err) {
    await appendLog(`[${new Date().toISOString()}] GIBS TILE FETCH ERROR: ${err}`);
    return NextResponse.json({ error: 'Error fetching GIBS tile.' }, { status: 500 });
  }
} 