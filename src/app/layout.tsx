import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Fira_Code } from 'next/font/google';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Satellite Intelligence Explorer",
  description: "Explore, analyze, and unlock insights from real-time NASA & Copernicus satellite imagery. Earth observation, reimagined.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/satellite-favicon.svg" type="image/svg+xml" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${firaCode.variable} font-sans antialiased`}
        style={{ fontFamily: 'Fira Code, var(--font-fira-code), var(--font-geist-sans), Arial, sans-serif' }}
      >
        {children}
      </body>
    </html>
  );
}
