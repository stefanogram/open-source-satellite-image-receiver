import axios from 'axios';

const NASA_API_KEY = process.env.NASA_API_KEY;

export const fetchSatelliteImages = async (lat: number, lon: number, date: string) => {
  const url = `https://api.nasa.gov/planetary/earth/imagery?lon=${lon}&lat=${lat}&date=${date}&api_key=${NASA_API_KEY}`;
  console.log('--- API Request Log ---');
  console.log('Attempting to fetch satellite image...');
  console.log('API Key:', NASA_API_KEY); // Log the API key
  console.log('Request URL:', url); // Log the constructed URL

  try {
    const response = await axios.get(url, { 
      responseType: 'blob',
      headers: {
        'Accept': 'image/png', // Specify the expected response type
      }
    });
    console.log('Response Status:', response.status); // Log the response status
    console.log('Response Data:', response.data); // Log the response data
    console.log('--- End API Request Log ---');
    return URL.createObjectURL(response.data);
  } catch (error: any) {
    console.error('--- API Request Error Log ---');
    console.error('Error fetching satellite images:', error);
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Error Response Status:', error.response.status);
      console.error('Error Response Data:', error.response.data);
      console.error('Error Response Headers:', error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('Error Request:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error Message:', error.message);
    }
    console.error('Config:', error.config);
    console.error('--- End API Request Error Log ---');
    throw error;
  }
}; 