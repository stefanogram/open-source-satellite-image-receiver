import React from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Custom red SVG marker icon
const redMarker = new L.Icon({
  iconUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="red" stroke="white" stroke-width="3"/></svg>',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
  shadowUrl: undefined,
  shadowSize: undefined,
  shadowAnchor: undefined,
});

interface MapPickerProps {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lon: number) => void;
}

const LocationMarker: React.FC<{ onChange: (lat: number, lon: number) => void; position: [number, number] }> = ({ onChange, position }) => {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return <Marker position={position} icon={redMarker} />;
};

const MapPicker: React.FC<MapPickerProps> = ({ latitude, longitude, onChange }) => {
  return (
    <div style={{ width: '100%', height: 400, marginTop: 24 }}>
      <MapContainer center={[latitude, longitude]} zoom={8} style={{ width: '100%', height: '100%' }} scrollWheelZoom={true}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <LocationMarker onChange={onChange} position={[latitude, longitude]} />
      </MapContainer>
    </div>
  );
};

export default MapPicker; 