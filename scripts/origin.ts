import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { defaults, POLICY_VERSION } from '../src/lib/origin/policy';
import { dossier, overview } from '../src/lib/origin/read-model';
import { migrate, saveSettings, start } from '../src/lib/origin/store';
import { createOriginLane } from '../src/lib/origin/worker';
import { createLimiter } from '../src/lib/bounded-work.cjs';

const connection = { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8_000, query_timeout: 15_000,
  ssl: process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n'), rejectUnauthorized: true } : { rejectUnauthorized: false } };

async function acceptance(admin: Pool) {
  const name = `origin_acceptance_${randomBytes(8).toString('hex')}`;
  await migrate(admin);
  await admin.query(`CREATE SCHEMA ${name}`);
  const pool = new Pool({ ...connection, options: `-c search_path=${name}`, max: 5 });
  let worker = createOriginLane(pool, createLimiter(3, 96));
  try {
    await migrate(pool);
    await saveSettings(pool, { ...defaults, candidateLimit: 12 });
    const id = await start(pool);
    const phases: string[] = [];
    const clock = Date.now();
    while (Date.now() - clock < 11 * 60_000 && await worker.runOnce()) {
      const { rows: [state] } = await pool.query(`SELECT state FROM origin_runs WHERE id=$1`, [id]);
      if (!['QUEUED', 'RUNNING'].includes(state.state)) break;
      const stage = (await pool.query('SELECT stage,count(*)::int AS count FROM origin_investigations GROUP BY stage ORDER BY stage')).rows;
      phases.push(JSON.stringify(stage));
      if (phases.length === 2) {
        // Replace the in-memory worker after a real saved discovery/identity checkpoint.
        worker.stop();
        worker = createOriginLane(pool, createLimiter(3, 96));
      }
    }
    const result = await overview(pool);
    const records = (await pool.query<{ id: string }>('SELECT id FROM origin_investigations ORDER BY created_at,id')).rows;
    const dossiers = [];
    for (const record of records) dossiers.push(await dossier(pool, record.id));
    const dir = resolve('data/engine-v2/origin');
    const captureDir = resolve(dir, `captures-${id}`);
    const captures = (await pool.query<{ id: string; image: Buffer }>('SELECT id,image FROM origin_artifacts WHERE image IS NOT NULL ORDER BY id')).rows;
    const artifactCount = captures.length;
    await mkdir(captureDir, { recursive: true });
    for (const capture of captures) await writeFile(resolve(captureDir, `${capture.id}.jpg`), capture.image, { flag: 'wx' });
    const report = `live-run-${id}.json`;
    await writeFile(resolve(dir, report), JSON.stringify({ id, phases, result, dossiers, artifactCount, captureDir }, null, 2), { flag: 'wx' });
    const summary = { id, state: result.runs[0]?.state, counts: result.runs[0]?.counts, sources: result.runs[0]?.sources,
      elapsedSeconds: Math.round((Date.now() - clock) / 1000), artifactCount, reservedRequests: result.usage.calls,
      report: `data/engine-v2/origin/${report}` };
    await admin.query(`INSERT INTO origin_evaluations(run_id,policy_version,kind,report) VALUES($1,$2,'LIVE',$3)`,
      [id, POLICY_VERSION, JSON.stringify(summary)]);
    console.log(JSON.stringify(summary, null, 2));
    if (result.runs[0]?.state !== 'COMPLETED' || !records.length) process.exitCode = 1;
  } finally {
    worker.stop();
    await pool.end();
    await admin.query(`DROP SCHEMA ${name} CASCADE`);
  }
}

async function main() {
  if (process.env.VERCEL) throw new Error('Run ORIGIN commands on the local worker computer.');
  const command = process.argv[2];
  const pool = new Pool(connection);
  try {
    if (command === 'acceptance') await acceptance(pool);
    else if (command === 'status') console.log(JSON.stringify(await overview(pool), null, 2));
    else if (command === 'migrate' || command === 'start') {
      await migrate(pool);
      if (command === 'start') {
        const id = await start(pool);
        if (!id) throw new Error('An ORIGIN run is already active.');
        await pool.query("SELECT pg_notify('compel_engine_wake','origin')");
        console.log(`Queued ORIGIN run ${id}.`);
      } else console.log('ORIGIN schema is ready.');
    } else throw new Error('Use migrate, start, status, or acceptance.');
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error('ORIGIN command failed.', error.code ?? error.name);
  process.exitCode = 1;
});
