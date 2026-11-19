import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/pg_setup';
import { requireWorkerAdmin } from '@/lib/worker-admin';
import { driveLocalRun, notifyAgent } from '@/lib/origin/operations';
import { artifact, dossier, overview } from '@/lib/origin/read-model';
import { settingsSchema } from '@/lib/origin/policy';
import { control, migrate, saveSettings, start } from '@/lib/origin/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const idSchema = z.string().uuid();
const mutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }).strict(),
  z.object({ action: z.literal('settings'), settings: settingsSchema }).strict(),
  z.object({ action: z.literal('pause'), id: idSchema }).strict(),
  z.object({ action: z.literal('resume'), id: idSchema }).strict(),
  z.object({ action: z.literal('cancel'), id: idSchema }).strict(),
]);
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const respond = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });

export async function GET(request: Request) {
  try { await requireWorkerAdmin(); }
  catch { return respond({ error: 'Open the local Compel OS dashboard to use ORIGIN.' }, 403); }
  const query = new URL(request.url).searchParams;
  const id = query.get('id');
  const image = query.get('artifact');
  if ((id && !idSchema.safeParse(id).success) || (image && (!id || !/^[a-f0-9]{64}$/.test(image))))
    return respond({ error: 'Invalid evidence reference.' }, 400);
  try {
    if (id && image) {
      const bytes = await artifact(pool, id, image);
      return bytes ? new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'image/jpeg' } })
        : respond({ error: 'This image is unavailable.' }, 404);
    }
    if (!id) return respond(await overview(pool));
    const data = await dossier(pool, id);
    return data ? respond(data) : respond({ error: 'This investigation is unavailable.' }, 404);
  } catch { return respond({ error: 'Could not load ORIGIN. Check the local PostgreSQL connection.' }, 503); }
}

export async function POST(request: Request) {
  try {
    await requireWorkerAdmin();
    const origin = new URL(request.headers.get('origin') ?? '');
    // Next may normalize the loopback hostname in request.url. Compare against the host checked by requireWorkerAdmin.
    if (origin.host !== request.headers.get('host') || origin.protocol !== new URL(request.url).protocol || request.headers.get('sec-fetch-site') === 'cross-site' ||
      !request.headers.get('content-type')?.startsWith('application/json')) throw new Error();
  } catch { return respond({ error: 'Use ORIGIN controls from the local dashboard.' }, 403); }
  let input;
  try {
    const body = await request.text();
    if (body.length > 8192) throw new Error();
    input = mutation.parse(JSON.parse(body));
  } catch { return respond({ error: 'Check the action and settings values.' }, 400); }
  try {
    if (input.action === 'start' || input.action === 'settings') await migrate(pool);
    if (input.action === 'start') {
      const id = await start(pool);
      if (!id) return respond({ error: 'An ORIGIN run is already active.' }, 409);
      driveLocalRun(pool, id);
    }
    if (input.action === 'settings') await saveSettings(pool, input.settings);
    if ('id' in input && !await control(pool, input.id, input.action)) return respond({ error: 'The run state changed. Refresh and try again.' }, 409);
    if (input.action === 'resume') driveLocalRun(pool, input.id);
    await notifyAgent(pool);
    return respond(await overview(pool));
  } catch { return respond({ error: 'Could not apply the ORIGIN action in PostgreSQL.' }, 503); }
}
