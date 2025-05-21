'use client';

import React, { useEffect, useState } from 'react';

const SatelliteImage = () => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [longitude, setLongitude] = useState<string>('-74.0060');
  const [latitude, setLatitude] = useState<string>('40.7128');
  const [date, setDate] = useState<string>('2023-01-01');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleFetchImage = async () => {
    try {
      setError(null); // Clear previous errors
      setImageUrl(null); // Clear previous image
      setIsLoading(true); // Set loading state

      const response = await fetch(`/api/fetch-image?lat=${latitude}&lon=${longitude}&date=${date}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const blob = await response.blob();
      const data = URL.createObjectURL(blob);
      setImageUrl(data);
    } catch (err: any) {
      // console.error('Fetching image from API route failed:', err); // Removed browser log
      setError(`Failed to fetch satellite image: ${err.message}`);
    } finally {
      setIsLoading(false); // Clear loading state
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <h2 className="text-2xl font-semibold">Satellite Image</h2>
      <div className="flex flex-col sm:flex-row gap-4 items-center">
        <label className="flex flex-col">
          Longitude:
          <input 
            type="text" 
            value={longitude} 
            onChange={(e) => setLongitude(e.target.value)} 
            className="px-2 py-1 border border-gray-300 rounded-md text-black"
          />
        </label>
        <label className="flex flex-col">
          Latitude:
          <input 
            type="text" 
            value={latitude} 
            onChange={(e) => setLatitude(e.target.value)} 
            className="px-2 py-1 border border-gray-300 rounded-md text-black"
          />
        </label>
        <label className="flex flex-col">
          Date:
          <input 
            type="date" 
            value={date} 
            onChange={(e) => setDate(e.target.value)} 
            className="px-2 py-1 border border-gray-300 rounded-md text-black"
          />
        </label>
        <button 
          onClick={handleFetchImage} 
          disabled={isLoading}
          className="mt-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? 'Fetching...' : 'Fetch Image'}
        </button>
      </div>
      {error && <p className="text-red-500 mt-4">{error}</p>}
      {isLoading && <p>Loading image...</p>}
      {imageUrl && 
        <div className="mt-4 max-w-full">
          <img src={imageUrl} alt="Satellite Image" className="max-w-full h-auto rounded-md shadow-lg" />
        </div>
      }
    </div>
  );
};

export default SatelliteImage; 