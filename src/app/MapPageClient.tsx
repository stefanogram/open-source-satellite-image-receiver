'use client';
import dynamic from 'next/dynamic';

const InteractiveMapExplorer = dynamic(() => import('./InteractiveMapExplorer'), { ssr: false });

export default function MapPageClient() {
  return <InteractiveMapExplorer />;
} 