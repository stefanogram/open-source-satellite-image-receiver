import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lon = searchParams.get('lon');
  const date = searchParams.get('date');

  if (!lat || !lon || !date) {
    const errorMessage = 'Missing latitude, longitude, or date parameter';
    await appendLog(`[${new Date().toISOString()}] Error: ${errorMessage}`);
    return new Response(errorMessage, { status: 400 });
  }

  const url = `https://api.nasa.gov/planetary/earth/imagery?lon=${lon}&lat=${lat}&date=${date}&api_key=${NASA_API_KEY}`;

  await appendLog(`[${new Date().toISOString()}] Request URL: ${url}`);
  await appendLog(`[${new Date().toISOString()}] API Key: ${NASA_API_KEY ? 'Provided' : 'Undefined'}`); // Log if key is provided or undefined

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer', // Use arraybuffer for image data
      headers: {
        'Accept': 'image/png', // Specify the expected response type
      },
    });

    await appendLog(`[${new Date().toISOString()}] Response Status: ${response.status}`);
    // We won't log the full image data to the file

    // Return the image data with the correct content type
    return new Response(response.data, {
      status: response.status,
      headers: { 'Content-Type': response.headers['content-type'] || 'image/png' },
    });

  } catch (error: any) {
    await appendLog(`[${new Date().toISOString()}] Error fetching satellite images: ${error.message}`);
    if (error.response) {
      await appendLog(`[${new Date().toISOString()}] Error Response Status: ${error.response.status}`);
      // Attempt to log error response data if it's not binary
      try {
        const errorData = JSON.stringify(error.response.data);
        await appendLog(`[${new Date().toISOString()}] Error Response Data: ${errorData}`);
      } catch (e) {
        await appendLog(`[${new Date().toISOString()}] Error Response Data: (Cannot log binary data)`);
      }
      await appendLog(`[${new Date().toISOString()}] Error Response Headers: ${JSON.stringify(error.response.headers)}`);
    } else if (error.request) {
      await appendLog(`[${new Date().toISOString()}] Error Request: No response received`);
    } else {
      await appendLog(`[${new Date().toISOString()}] Error Message: ${error.message}`);
    }

    // Pass the error status from the NASA API if available, otherwise use 500
    return new Response(error.message || 'Internal Server Error', {
      status: error.response?.status || 500,
    });
  }
} 