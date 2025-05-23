import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const logFilePath = path.join(process.cwd(), 'logs', 'api-requests.log');

export async function POST(request: Request) {
  try {
    const log = await request.json();
    await fs.appendFile(logFilePath, `[${new Date().toISOString()}] CLIENT_LOG: ${JSON.stringify(log)}\n`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to log' }, { status: 500 });
  }
} 