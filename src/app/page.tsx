import SatelliteImage from './SatelliteImage';

export default function Home() {
  return (
    <div className="flex flex-col items-center min-h-screen p-4 pb-10 gap-8 sm:p-8 sm:pb-10 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-4 items-center sm:items-start w-full max-w-4xl mt-8">
        <h1 className="text-3xl font-bold text-center sm:text-left">Satellite Image Viewer</h1>
        <p className="text-lg text-center sm:text-left">This app fetches and displays satellite images from NASA's Earth API. Enter coordinates and a date to view images of Earth from space.</p>
        <SatelliteImage />
      </main>
    </div>
  );
}
