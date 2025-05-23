'use client';
import MapPageClient from './MapPageClient';

export default function Home() {
  return (
    <div className="flex flex-col items-center min-h-screen p-4 pb-10 gap-8 sm:p-8 sm:pb-10 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-4 items-center sm:items-start w-full max-w-4xl mt-8">
        <h1 className="text-4xl font-extrabold text-center sm:text-left tracking-tight">Satellite Intelligence Explorer</h1>
        <p className="text-lg text-center sm:text-left text-neutral-400 dark:text-neutral-300 font-mono mt-2">
          Explore the world in near real-time with high-resolution satellite imagery from NASA and Copernicus.<br/>
          Instantly visualize, analyze, and unlock insights from space—right in your browser. <span className="font-semibold text-blue-500">Empower your research, response, and discovery with the power of Earth observation.</span>
        </p>
        <MapPageClient />
      </main>
    </div>
  );
}
