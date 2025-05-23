'use client';
import React, { useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L, { LeafletMouseEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

const redMarker = new L.Icon({
  iconUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="red" stroke="white" stroke-width="3"/></svg>',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

const defaultCenter: [number, number] = [37.983810, 23.727539]; // Athens, Greece

const timezones = [
  { label: 'Greece (EET/EEST)', value: 'Europe/Athens' },
  { label: 'UTC', value: 'UTC' },
  // Add more as needed
];

const sourceOptions = [
  { label: 'NASA', value: 'nasa' },
  { label: 'Copernicus', value: 'copernicus' },
  { label: 'NASA GIBS', value: 'gibs' },
];

const resolutionOptions = [
  { label: '512px', value: '512' },
  { label: '1024px', value: '1024' },
  { label: '2048px', value: '2048' },
];

const gibsLayerOptions = [
  { label: 'MODIS Terra True Color', value: 'MODIS_Terra_CorrectedReflectance_TrueColor' },
  { label: 'MODIS Aqua True Color', value: 'MODIS_Aqua_CorrectedReflectance_TrueColor' },
  { label: 'VIIRS SNPP True Color', value: 'VIIRS_SNPP_CorrectedReflectance_TrueColor' },
  // Add more GIBS layers as needed
];

// Helper to log user actions to the backend
async function logUserAction(action: string, details: any) {
  try {
    await fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        details,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (e) {
    // Ignore logging errors
  }
}

const InteractiveMapExplorer = ({ onBack }: { onBack: () => void }) => {
  const [center, setCenter] = useState<[number, number]>(defaultCenter);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState<string>('12:00');
  const [timezone, setTimezone] = useState<string>('Europe/Athens');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [source, setSource] = useState<string>('nasa');
  const [availability, setAvailability] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<string | null>(null);
  const [fetchingImage, setFetchingImage] = useState(false);
  const [resolution, setResolution] = useState<string>('1024');
  const [availableDates, setAvailableDates] = useState<string[]>([]); // For NASA
  const [closestDate, setClosestDate] = useState<string | null>(null); // For NASA
  const [availableScenes, setAvailableScenes] = useState<any[]>([]); // For Copernicus
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nextAvailable, setNextAvailable] = useState<string | null>(null);
  const [prevAvailable, setPrevAvailable] = useState<string | null>(null);
  const [selectedScene, setSelectedScene] = useState<any | null>(null); // For Copernicus fetch
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [cloudCoverFilter, setCloudCoverFilter] = useState(100);
  const [dim, setDim] = useState(0.2); // For NASA only
  const mapRef = useRef<any>(null);
  const [exploreCollapsed, setExploreCollapsed] = useState(true);
  const [sourceCollapsed, setSourceCollapsed] = useState(true);
  const [showPrompt, setShowPrompt] = useState(true);
  const [showExpandHint, setShowExpandHint] = useState(true);
  const [gibsLayer, setGibsLayer] = useState<string>('MODIS_Terra_CorrectedReflectance_TrueColor');
  const [gibsPreviewUrl, setGibsPreviewUrl] = useState<string | null>(null);
  const [gibsPreviewError, setGibsPreviewError] = useState<string | null>(null);
  const [gibsActualDate, setGibsActualDate] = useState<string | null>(null);

  React.useEffect(() => {
    if (!exploreCollapsed || !sourceCollapsed) {
      setShowPrompt(false);
      logUserAction('close_prompt', {});
      return;
    }
    const timer = setTimeout(() => {
      setShowPrompt(false);
      logUserAction('auto_close_prompt', {});
    }, 4000);
    return () => clearTimeout(timer);
  }, [exploreCollapsed, sourceCollapsed]);

  React.useEffect(() => {
    if (!exploreCollapsed || !sourceCollapsed) {
      setShowExpandHint(false);
      return;
    }
    const timer = setTimeout(() => setShowExpandHint(false), 6000);
    return () => clearTimeout(timer);
  }, [exploreCollapsed, sourceCollapsed]);

  // Geocoding search handler (Nominatim)
  const handleSearch = async () => {
    if (!search) return;
    logUserAction('search', { query: search });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(search)}`);
    const data = await res.json();
    setSearchResults(data);
    setShowResults(true);
  };

  // Map click handler
  const MapEvents = () => {
    useMapEvents({
      click: (e: LeafletMouseEvent) => {
        setCenter([e.latlng.lat, e.latlng.lng]);
        logUserAction('map_click', { lat: e.latlng.lat, lon: e.latlng.lng });
      },
    });
    return null;
  };

  // Check Availability handler
  const handleCheckAvailability = async () => {
    logUserAction('check_availability', { center, date, time, timezone, source, resolution, dim });
    setAvailability('Checking...');
    setAvailableDates([]);
    setClosestDate(null);
    setAvailableScenes([]);
    setImageUrl(null);
    setImageMeta(null);
    setErrorMsg(null);
    setNextAvailable(null);
    setPrevAvailable(null);
    setGibsPreviewUrl(null);
    setGibsPreviewError(null);
    if (source === 'nasa') {
      // NASA: GET with params
      const params = new URLSearchParams({
        lat: center[0].toString(),
        lon: center[1].toString(),
        date,
        resolution,
        dim: dim.toString(),
      });
      try {
        const res = await fetch(`/api/fetch-image?${params.toString()}`);
        if (res.ok) {
          setAvailability('Imagery available!');
        } else {
          const data = await res.json();
          setAvailability(data.error || 'No imagery available for this date/location.');
          setAvailableDates(data.availableDates || []);
          setClosestDate(data.closestDate || null);
          setErrorMsg(data.error || null);
          // Find next and previous available dates
          if (data.availableDates && data.availableDates.length > 0) {
            const sorted = [...data.availableDates].sort();
            const idx = sorted.findIndex((d: string) => d === data.closestDate);
            setPrevAvailable(idx > 0 ? sorted[idx - 1] : null);
            setNextAvailable(idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null);
          }
        }
      } catch (err) {
        setAvailability('Error checking availability.');
        setErrorMsg('Error checking availability.');
      }
    } else if (source === 'gibs') {
      // GIBS: fetch preview tile for center, zoom 8
      const z = 8;
      const lat = center[0];
      const lon = center[1];
      const n = Math.pow(2, z);
      const x = Math.floor((lon + 180) / 360 * n);
      const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
      const tileUrl = `/api/fetch-gibs-image?layer=${gibsLayer}&date=${date}&z=${z}&x=${x}&y=${y}`;
      logUserAction('gibs_preview_tile', { tileUrl, center, date, gibsLayer, z, x, y });
      // Fetch available dates for the layer
      try {
        const datesRes = await fetch(`/api/fetch-gibs-image?action=available-dates&layer=${gibsLayer}`);
        let actualDate = date;
        if (datesRes.ok) {
          const datesData = await datesRes.json();
          if (datesData.availableDates && datesData.availableDates.length > 0) {
            // Find closest date <= requested date
            const requested = new Date(date);
            let closest = datesData.availableDates[0];
            let minDiff = Math.abs(new Date(closest).getTime() - requested.getTime());
            for (const d of datesData.availableDates) {
              const diff = Math.abs(new Date(d).getTime() - requested.getTime());
              if (diff < minDiff) {
                closest = d;
                minDiff = diff;
              }
            }
            actualDate = closest;
          }
        }
        setGibsActualDate(actualDate);
        logUserAction('gibs_actual_image_date', { requested: date, actual: actualDate, gibsLayer });
      } catch (err) {
        setGibsActualDate(null);
      }
      // Fetch the tile as before
      try {
        const res = await fetch(tileUrl);
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          setGibsPreviewUrl(url);
          setGibsPreviewError(null);
          setAvailability('GIBS tile available!');
        } else {
          setGibsPreviewUrl(null);
          setGibsPreviewError('No tile available for this layer/date/position.');
          setAvailability('No GIBS tile available.');
        }
      } catch (err) {
        setGibsPreviewUrl(null);
        setGibsPreviewError('Error fetching GIBS tile.');
        setAvailability('Error fetching GIBS tile.');
      }
    } else {
      // Copernicus: POST to /api/fetch-copernicus-image/copernicus-availability
      try {
        const res = await fetch('/api/fetch-copernicus-image/copernicus-availability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: center[0],
            lon: center[1],
            date,
            time,
            timezone,
            resolution,
            dim,
          }),
        });
        const data = await res.json();
        if (res.ok && data.scenes && data.scenes.length > 0) {
          // Filter by cloud cover
          const filtered = data.scenes.filter((s: any) => (s.cloudCover ?? 100) <= cloudCoverFilter);
          setAvailableScenes(filtered);
          if (filtered.length > 0) {
            // Auto-select the closest scene to the requested date
            const requestedTime = new Date(date).getTime();
            let closest = filtered[0];
            let minDiff = Math.abs(new Date(filtered[0].datetime).getTime() - requestedTime);
            for (const scene of filtered) {
              const diff = Math.abs(new Date(scene.datetime).getTime() - requestedTime);
              if (diff < minDiff) {
                closest = scene;
                minDiff = diff;
              }
            }
            setSelectedScene(closest);
            logUserAction('auto_select_scene', { scene: closest });
            setErrorMsg('Select a scene to fetch image, or use the closest auto-selected.');
          } else {
            setErrorMsg('No scenes match the cloud cover filter.');
            setSelectedScene(null);
          }
        } else {
          setErrorMsg('No imagery available for this date/location.');
          setAvailableScenes([]);
          setSelectedScene(null);
        }
      } catch (err) {
        setAvailability('Error checking availability.');
        setErrorMsg('Error checking availability.');
      }
    }
  };

  // Fetch Image handler
  const handleFetchImage = async () => {
    logUserAction('fetch_image', { center, date, time, timezone, source, resolution, selectedScene, dim });
    setFetchingImage(true);
    setImageUrl(null);
    setImageMeta(null);
    setAvailability(null);
    setGibsPreviewUrl(null);
    setGibsPreviewError(null);
    if (source === 'copernicus') {
      if (!selectedScene || !selectedScene.datetime) {
        setImageMeta('Please select a valid scene.');
        setFetchingImage(false);
        return;
      }
      const endpoint = '/api/fetch-copernicus-image';
      const params = new URLSearchParams({
        lat: center[0].toString(),
        lon: center[1].toString(),
        acquisitionTime: selectedScene.datetime,
        resolution,
        dim: dim.toString(),
      });
      try {
        const res = await fetch(`${endpoint}?${params.toString()}`);
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          setImageUrl(url);
          const meta = res.headers.get('x-image-metadata') || '';
          setImageMeta(meta);
        } else {
          setImageUrl(null);
          setImageMeta('No image available for this date/location.');
        }
      } catch (err) {
        setImageUrl(null);
        setImageMeta('Error fetching image.');
      } finally {
        setFetchingImage(false);
      }
      return;
    }
    if (source === 'gibs') {
      // GIBS: fetch preview tile for center, zoom 8
      const z = 8;
      const lat = center[0];
      const lon = center[1];
      const n = Math.pow(2, z);
      const x = Math.floor((lon + 180) / 360 * n);
      const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
      const tileUrl = `/api/fetch-gibs-image?layer=${gibsLayer}&date=${date}&z=${z}&x=${x}&y=${y}`;
      logUserAction('gibs_fetch_tile', { tileUrl, center, date, gibsLayer, z, x, y });
      // Fetch available dates for the layer
      try {
        const datesRes = await fetch(`/api/fetch-gibs-image?action=available-dates&layer=${gibsLayer}`);
        let actualDate = date;
        if (datesRes.ok) {
          const datesData = await datesRes.json();
          if (datesData.availableDates && datesData.availableDates.length > 0) {
            // Find closest date <= requested date
            const requested = new Date(date);
            let closest = datesData.availableDates[0];
            let minDiff = Math.abs(new Date(closest).getTime() - requested.getTime());
            for (const d of datesData.availableDates) {
              const diff = Math.abs(new Date(d).getTime() - requested.getTime());
              if (diff < minDiff) {
                closest = d;
                minDiff = diff;
              }
            }
            actualDate = closest;
          }
        }
        setGibsActualDate(actualDate);
        logUserAction('gibs_actual_image_date', { requested: date, actual: actualDate, gibsLayer });
      } catch (err) {
        setGibsActualDate(null);
      }
      // Fetch the tile as before
      try {
        const res = await fetch(tileUrl);
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          setGibsPreviewUrl(url);
          setGibsPreviewError(null);
          setAvailability('GIBS tile available!');
        } else {
          setGibsPreviewUrl(null);
          setGibsPreviewError('No tile available for this layer/date/position.');
          setAvailability('No GIBS tile available.');
        }
      } catch (err) {
        setGibsPreviewUrl(null);
        setGibsPreviewError('Error fetching GIBS tile.');
        setAvailability('Error fetching GIBS tile.');
      } finally {
        setFetchingImage(false);
      }
      return;
    }
    // NASA logic (unchanged)
    const endpoint = '/api/fetch-image';
    const params = new URLSearchParams({
      lat: center[0].toString(),
      lon: center[1].toString(),
      date,
      resolution,
      dim: dim.toString(),
    });
    try {
      const res = await fetch(`${endpoint}?${params.toString()}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setImageUrl(url);
        const meta = res.headers.get('x-image-metadata') || '';
        setImageMeta(meta);
      } else {
        setImageUrl(null);
        setImageMeta('No image available for this date/location.');
      }
    } catch (err) {
      setImageUrl(null);
      setImageMeta('Error fetching image.');
    } finally {
      setFetchingImage(false);
    }
  };

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'dark' ? 'light' : 'dark');
    logUserAction('toggle_theme', { theme: theme === 'dark' ? 'light' : 'dark' });
  };

  return (
    <div className="relative w-full h-screen bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 font-sans font-[var(--font-fira-code)]">
      {showPrompt && (
        <div className="fixed top-8 right-8 z-[10000] bg-white dark:bg-neutral-900 border border-blue-400 dark:border-blue-600 shadow-lg px-4 py-2 rounded-md flex items-center gap-2 animate-fade-in text-sm font-medium text-blue-700 dark:text-blue-300">
          <svg className="w-5 h-5 text-blue-400 dark:text-blue-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01" /></svg>
          Open the controls to start exploring!
        </div>
      )}
      {/* Controls + Popup Wrapper */}
      <div className="absolute top-6 right-6 z-[9999]" style={{ minWidth: 320, maxWidth: 384 }}>
        <div className="flex flex-col gap-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-5 rounded-md shadow-md w-full">
          <div className="mb-1 text-base font-bold tracking-tight flex items-center justify-between font-[var(--font-fira-code)]">
            <span>Explore & Search</span>
            <button
              className="ml-2 p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 transition"
              onClick={() => { setExploreCollapsed(v => { logUserAction('toggle_explore_section', { collapsed: !v }); return !v; }); }}
              aria-label={exploreCollapsed ? 'Expand' : 'Collapse'}
              tabIndex={0}
            >
              <svg className={`w-5 h-5 transition-transform ${exploreCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              {exploreCollapsed && <span className="ml-2 text-xs italic text-neutral-400">expand</span>}
            </button>
          </div>
          {!exploreCollapsed && (
            <div className="flex flex-col gap-2 mb-2">
              <label className="text-xs font-semibold mb-1">Search place</label>
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={search}
                  onChange={e => { setSearch(e.target.value); logUserAction('change_search', { search: e.target.value }); }}
                  placeholder="Type a location..."
                  className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                />
                <button onClick={handleSearch} className="px-3 py-2 bg-blue-600 text-white rounded-sm font-medium hover:bg-blue-700 transition text-sm">Search</button>
              </div>
              {showResults && searchResults.length > 0 && (
                <div className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-sm shadow mt-2 max-h-40 overflow-y-auto border border-neutral-200 dark:border-neutral-700 text-sm">
                  {searchResults.map((r, i) => (
                    <div
                      key={i}
                      className="px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900 cursor-pointer rounded-sm"
                      onClick={() => {
                        const lat = parseFloat(r.lat);
                        const lon = parseFloat(r.lon);
                        setCenter([lat, lon]);
                        setShowResults(false);
                        if (mapRef.current) {
                          mapRef.current.setView([lat, lon], mapRef.current.getZoom());
                        }
                        logUserAction('search_result_click', { lat, lon, display_name: r.display_name });
                      }}
                    >
                      {r.display_name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <hr className="border-neutral-200 dark:border-neutral-800 my-1" />
          <div className="mb-1 text-base font-bold tracking-tight font-[var(--font-fira-code)]">Date & Time</div>
          <div className="flex flex-col gap-2 mb-2">
            <label className="text-xs font-semibold mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); logUserAction('change_date', { date: e.target.value }); }}
              className="px-2 py-1 border border-neutral-300 dark:border-neutral-700 rounded-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
            />
            <label className="text-xs font-semibold mb-1">Time</label>
            <input
              type="time"
              value={time}
              onChange={e => { setTime(e.target.value); logUserAction('change_time', { time: e.target.value }); }}
              className="px-2 py-1 border border-neutral-300 dark:border-neutral-700 rounded-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
            />
            <label className="text-xs font-semibold mb-1">Timezone</label>
            <select
              value={timezone}
              onChange={e => { setTimezone(e.target.value); logUserAction('change_timezone', { timezone: e.target.value }); }}
              className="px-2 py-1 border border-neutral-300 dark:border-neutral-700 rounded-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
            >
              {timezones.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </select>
          </div>
          <hr className="border-neutral-200 dark:border-neutral-800 my-1" />
          <div className="mb-1 text-base font-bold tracking-tight flex items-center justify-between font-[var(--font-fira-code)]">
            <span>Source & Quality</span>
            <button
              className="ml-2 p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 transition"
              onClick={() => { setSourceCollapsed(v => { logUserAction('toggle_source_section', { collapsed: !v }); return !v; }); }}
              aria-label={sourceCollapsed ? 'Expand' : 'Collapse'}
              tabIndex={0}
            >
              <svg className={`w-5 h-5 transition-transform ${sourceCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              {sourceCollapsed && <span className="ml-2 text-xs italic text-neutral-400">expand</span>}
            </button>
          </div>
          {!sourceCollapsed && (
            <div className="flex flex-col gap-2 mb-2">
              <label className="text-xs font-semibold mb-1">Source</label>
              <select value={source} onChange={e => { setSource(e.target.value); logUserAction('change_source', { source: e.target.value }); }} className="px-2 py-1 border border-neutral-300 dark:border-neutral-700 rounded-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm">
                {sourceOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              {(source === 'nasa' || source === 'copernicus') && (
                <div className="flex items-center gap-2 mt-2">
                  <label className="text-xs font-semibold">Field of View (dim):</label>
                  <input
                    type="range"
                    min="0.01"
                    max="1.0"
                    step="0.01"
                    value={dim}
                    onChange={e => { setDim(parseFloat(e.target.value)); logUserAction('change_dim', { dim: parseFloat(e.target.value), source }); }}
                    className="w-24 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-sm appearance-none cursor-pointer"
                  />
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">{dim}</span>
                </div>
              )}
              {source === 'gibs' && (
                <div className="flex flex-col gap-2 mt-2">
                  <label className="text-xs font-semibold mb-1">GIBS Layer</label>
                  <select value={gibsLayer} onChange={e => { setGibsLayer(e.target.value); logUserAction('change_gibs_layer', { gibsLayer: e.target.value }); }} className="px-2 py-1 border border-neutral-300 dark:border-neutral-700 rounded-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm">
                    {gibsLayerOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              )}
              <label className="text-xs font-semibold mb-1">Resolution</label>
              <select value={resolution} onChange={e => { setResolution(e.target.value); logUserAction('change_resolution', { resolution: e.target.value }); }} className="px-2 py-1 border border-neutral-300 dark:border-neutral-700 rounded-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm">
                {resolutionOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <label className="text-xs font-semibold mb-1">Cloud Cover</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={cloudCoverFilter}
                  onChange={e => { setCloudCoverFilter(parseInt(e.target.value)); logUserAction('change_cloud_cover_filter', { cloudCoverFilter: parseInt(e.target.value) }); }}
                  className="w-24 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-sm appearance-none cursor-pointer"
                />
                <span className="text-xs text-neutral-500 dark:text-neutral-400">{cloudCoverFilter}%</span>
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <button
              className="flex-1 px-3 py-2 bg-yellow-500 text-neutral-900 rounded-sm font-semibold hover:bg-yellow-400 transition text-sm"
              onClick={handleCheckAvailability}
            >
              Check Availability
            </button>
            <button
              className="flex-1 px-3 py-2 bg-green-600 text-white rounded-sm font-semibold hover:bg-green-700 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleFetchImage}
              disabled={fetchingImage || (source === 'copernicus' && (!selectedScene || !selectedScene.datetime))}
            >
              {fetchingImage ? 'Fetching...' : 'Fetch Image'}
            </button>
          </div>
        </div>
      </div>
      {/* Map */}
      <div className="w-full h-full">
        <MapContainer ref={mapRef} center={center} zoom={8} style={{ width: '100%', height: '100%' }} scrollWheelZoom={true}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Marker position={center} icon={redMarker} />
          <MapEvents />
          {source === 'gibs' && (
            <TileLayer
              url={`/api/fetch-gibs-image?layer=${gibsLayer}&date=${date}&z={z}&x={x}&y={y}`}
              attribution="Imagery courtesy NASA EOSDIS GIBS"
              opacity={0.8}
            />
          )}
        </MapContainer>
      </div>
      {/* Info Panel (show coordinates) */}
      <div className="absolute bottom-6 left-6 z-[9999] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100 p-5 rounded-md shadow-md min-w-[320px] max-w-lg">
        <div className="text-center">
          <div className="mb-2 font-mono text-base font-medium flex items-center justify-center gap-2">
            Lat: {center[0].toFixed(6)}, Lon: {center[1].toFixed(6)}
          </div>
          {imageUrl ? (
            <div className="relative">
              <button
                className="absolute top-0 right-0 mt-1 mr-1 bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-300 z-10"
                onClick={() => { setImageUrl(null); setImageMeta(null); logUserAction('close_image_preview', {}); }}
                title="Close image preview"
              >
                ×
              </button>
              <img
                src={imageUrl}
                alt="Satellite"
                className="mx-auto my-2 max-h-48 rounded-sm shadow border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                onClick={() => { window.open(imageUrl || '', '_blank'); logUserAction('open_image_preview', { imageUrl }); }}
                title="Click to open full image in new tab"
              />
              {/* Actual image date for all sources */}
              {source === 'nasa' && imageMeta && (
                <div className="text-xs mt-1 text-blue-700 dark:text-blue-300 font-semibold">
                  Actual image date: {imageMeta}
                  {imageMeta !== date && (
                    <span className="ml-2 text-neutral-500 dark:text-neutral-400">(requested: {date})</span>
                  )}
                </div>
              )}
              {source === 'copernicus' && selectedScene && selectedScene.datetime && (
                <div className="text-xs mt-1 text-blue-700 dark:text-blue-300 font-semibold">
                  Actual image date: {selectedScene.datetime}
                  {selectedScene.datetime.slice(0, 10) !== date && (
                    <span className="ml-2 text-neutral-500 dark:text-neutral-400">(requested: {date})</span>
                  )}
                </div>
              )}
              {source === 'gibs' && gibsActualDate && (
                <div className="text-xs mt-1 text-blue-700 dark:text-blue-300 font-semibold">
                  Actual image date: {gibsActualDate}
                  {gibsActualDate !== date && (
                    <span className="ml-2 text-neutral-500 dark:text-neutral-400">(requested: {date})</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <p className="font-medium text-base text-neutral-800 dark:text-neutral-200 mb-2">{availability ? availability : '[Image metadata/info will appear here]'}</p>
              {errorMsg && <div className="text-xs text-red-600 dark:text-red-400 font-semibold mb-2">{errorMsg}</div>}
              {/* NASA: Show available dates if no image */}
              {source === 'nasa' && availableDates.length > 0 && (
                <div className="mt-2">
                  <div className="font-semibold text-yellow-700 dark:text-yellow-300 mb-1 text-sm">Available Dates (±7 days):</div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {availableDates.map(d => (
                      <span
                        key={d}
                        className={`px-2 py-1 rounded-sm text-xs font-medium border ${d === closestDate ? 'bg-green-600 text-white border-green-700' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-100 border-neutral-300 dark:border-neutral-600'} hover:bg-green-500 hover:text-white transition cursor-pointer`}
                        onClick={() => { setDate(d); setAvailability(''); setAvailableDates([]); setClosestDate(null); setErrorMsg(null); setNextAvailable(null); setPrevAvailable(null); logUserAction('select_nasa_date', { date: d }); }}
                      >
                        {d.slice(0, 10)}
                      </span>
                    ))}
                  </div>
                  {closestDate && <div className="text-xs mt-1 text-green-600 dark:text-green-400 font-medium">Closest: {closestDate.slice(0, 10)}</div>}
                  <div className="flex gap-2 mt-1">
                    {prevAvailable && <button className="px-2 py-1 rounded-sm text-xs bg-blue-700 text-white hover:bg-blue-500 transition" onClick={() => { setDate(prevAvailable.slice(0, 10)); setTime(prevAvailable.slice(11, 16)); setAvailability(''); setAvailableDates([]); setClosestDate(null); setErrorMsg(null); setNextAvailable(null); setPrevAvailable(null); logUserAction('navigate_prev_nasa_date', { prevAvailable }); }}>Previous: {prevAvailable.slice(0, 10)} {prevAvailable.slice(11, 16)}</button>}
                    {nextAvailable && <button className="px-2 py-1 rounded-sm text-xs bg-blue-700 text-white hover:bg-blue-500 transition" onClick={() => { setDate(nextAvailable.slice(0, 10)); setTime(nextAvailable.slice(11, 16)); setAvailability(''); setAvailableDates([]); setClosestDate(null); setErrorMsg(null); setNextAvailable(null); setPrevAvailable(null); logUserAction('navigate_next_nasa_date', { nextAvailable }); }}>Next: {nextAvailable.slice(0, 10)} {nextAvailable.slice(11, 16)}</button>}
                  </div>
                </div>
              )}
              {/* Copernicus: Show available scenes if no image */}
              {source === 'copernicus' && availableScenes.length > 0 && (
                <div className="mt-2">
                  <div className="font-semibold text-yellow-700 dark:text-yellow-300 mb-1 text-sm">Available Scenes (±7 days):</div>
                  <div className="flex flex-col gap-2 mt-1 max-h-40 overflow-y-auto">
                    {availableScenes.map((scene: any) => (
                      <span
                        key={scene.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-sm text-xs font-medium border ${selectedScene && selectedScene.id === scene.id ? 'bg-green-600 text-white border-green-700' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-100 border-neutral-300 dark:border-neutral-600'} hover:bg-green-500 hover:text-white transition cursor-pointer`}
                        onClick={() => {
                          setSelectedScene(scene);
                          setDate(scene.datetime.slice(0, 10));
                          setTime(scene.datetime.slice(11, 16));
                          setAvailability('');
                          setAvailableScenes([]);
                          setErrorMsg(null);
                          setNextAvailable(null);
                          setPrevAvailable(null);
                          logUserAction('select_scene', { scene });
                        }}
                        title={`Cloud: ${scene.cloudCover ?? 'N/A'}%`}
                      >
                        <span className="font-mono">{scene.datetime ? `${scene.datetime.slice(0, 10)} ${scene.datetime.slice(11, 16)}` : 'Unknown'}</span>
                        {scene.cloudCover !== undefined && (
                          <span className="ml-2 text-xs text-blue-500 dark:text-blue-200">☁️ {scene.cloudCover}%</span>
                        )}
                        <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-300">{scene.platform?.toUpperCase?.() || ''}</span>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-1">
                    {prevAvailable && <button className="px-2 py-1 rounded-sm text-xs bg-blue-700 text-white hover:bg-blue-500 transition" onClick={() => { setDate(prevAvailable.slice(0, 10)); setTime(prevAvailable.slice(11, 16)); setAvailability(''); setAvailableScenes([]); setErrorMsg(null); setNextAvailable(null); setPrevAvailable(null); logUserAction('navigate_prev_scene', { prevAvailable }); }}>Previous: {prevAvailable.slice(0, 10)} {prevAvailable.slice(11, 16)}</button>}
                    {nextAvailable && <button className="px-2 py-1 rounded-sm text-xs bg-blue-700 text-white hover:bg-blue-500 transition" onClick={() => { setDate(nextAvailable.slice(0, 10)); setTime(nextAvailable.slice(11, 16)); setAvailability(''); setAvailableScenes([]); setErrorMsg(null); setNextAvailable(null); setPrevAvailable(null); logUserAction('navigate_next_scene', { nextAvailable }); }}>Next: {nextAvailable.slice(0, 10)} {nextAvailable.slice(11, 16)}</button>}
                  </div>
                </div>
              )}
              {/* GIBS: Show preview if present */}
              {source === 'gibs' && gibsPreviewUrl && (
                <div className="mt-2 relative">
                  <button
                    className="absolute top-0 right-0 mt-1 mr-1 bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-300 z-10"
                    onClick={() => { setGibsPreviewUrl(null); setGibsPreviewError(null); setGibsActualDate(null); logUserAction('close_gibs_preview', {}); }}
                    title="Close GIBS preview"
                  >
                    ×
                  </button>
                  <div className="font-semibold text-yellow-700 dark:text-yellow-300 mb-1 text-sm">GIBS Tile Preview (center, z=8):</div>
                  <img
                    src={gibsPreviewUrl}
                    alt="GIBS Tile Preview"
                    className="mx-auto my-2 max-h-48 rounded-sm shadow border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                    onClick={async () => {
                      // Fetch the high-res stitched image and open in new tab
                      const z = 8;
                      const lat = center[0];
                      const lon = center[1];
                      const n = Math.pow(2, z);
                      const x = Math.floor((lon + 180) / 360 * n);
                      const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
                      const tileUrl = `/api/fetch-gibs-image?layer=${gibsLayer}&date=${date}&z=${z}&x=${x}&y=${y}&resolution=${resolution}`;
                      try {
                        const res = await fetch(tileUrl);
                        if (res.ok) {
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          window.open(url, '_blank');
                          logUserAction('open_gibs_image_preview_highres', { tileUrl, resolution });
                        }
                      } catch {}
                    }}
                    title="Click to open high-res image in new tab"
                  />
                  <div className="text-xs mt-1 text-neutral-700 dark:text-neutral-300 break-all">Tile URL: <span className="font-mono">{`/api/fetch-gibs-image?layer=${gibsLayer}&date=${date}&z=8&x=${Math.floor((center[1] + 180) / 360 * Math.pow(2,8))}&y=${Math.floor((1 - Math.log(Math.tan(center[0] * Math.PI / 180) + 1 / Math.cos(center[0] * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2,8))}`}</span></div>
                  {gibsActualDate && (
                    <div className="text-xs mt-1 text-blue-700 dark:text-blue-300 font-semibold">
                      Actual image date: {gibsActualDate}
                      {gibsActualDate !== date && (
                        <span className="ml-2 text-neutral-500 dark:text-neutral-400">(requested: {date})</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {source === 'gibs' && gibsPreviewError && (
                <div className="mt-2 text-xs text-red-600 dark:text-red-400 font-semibold">{gibsPreviewError}</div>
              )}
            </div>
          )}
        </div>
      </div>
      {/* Theme Toggle */}
      <button
        onClick={() => { toggleTheme(); logUserAction('toggle_theme', { theme: theme === 'dark' ? 'light' : 'dark' }); }}
        className="fixed bottom-6 right-6 z-50 bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-full shadow px-4 py-2 transition-colors duration-300 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-700"
        aria-label="Toggle dark/light mode"
      >
        {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
      </button>
    </div>
  );
};

export default InteractiveMapExplorer; 