import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const logFilePath = path.join(process.cwd(), 'logs', 'api-requests.log');
const MAX_PAYLOAD_BYTES = 2048;
const SAFE_ACTION_REGEX = /^[a-z0-9_]{1,50}$/i;

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    const log = JSON.parse(rawBody);
    const action = typeof log?.action === 'string' && SAFE_ACTION_REGEX.test(log.action)
      ? log.action
      : 'unknown_action';
    const sanitizedEntry = JSON.stringify({
      action,
      details: log?.details ?? {},
      timestamp: typeof log?.timestamp === 'string' ? log.timestamp.slice(0, 40) : new Date().toISOString(),
    }).replace(/[\r\n]+/g, ' ');

    await fs.mkdir(path.dirname(logFilePath), { recursive: true });
    await fs.appendFile(logFilePath, `[${new Date().toISOString()}] CLIENT_LOG: ${sanitizedEntry}\n`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to log' }, { status: 400 });
  }
}
