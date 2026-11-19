import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';

const launcher = resolve('origin.cjs');
function cli(args: string[], env = process.env) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(complete => {
    execFile(process.execPath, [launcher, ...args], { env, timeout: 30_000, maxBuffer: 1_000_000, windowsHide: true }, (error, stdout, stderr) => {
      complete({ code: error ? Number(error.code) || 1 : 0, stdout, stderr });
    });
  });
}

test('CLI help and invalid options are available before connecting to PostgreSQL', async () => {
  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  for (const command of ['doctor', 'investigations', 'opportunities', 'evidence', 'benchmark']) assert.match(help.stdout, new RegExp(command));
  assert.equal((await cli(['doctor', '--no-browser'])).code, 2);
  assert.notEqual((await cli(['unknown'])).code, 0);
});

test('the actual CLI manages saved settings, readiness, sources, run controls and evaluation', {
  skip: process.env.ORIGIN_TEST_POSTGRES !== '1', timeout: 170_000,
}, async () => {
  const schema = `origin_cli_test_${randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    const env = { ...process.env, PGOPTIONS: `-c search_path=${schema}`, ORIGIN_APPROVED_FEEDS: '[]' };
    async function call(args: string[], code = 0) {
      const result = await cli(args, env);
      assert.equal(result.code, code, args.join(' ') + ' ' + result.stderr);
      return result.stdout ? JSON.parse(result.stdout) : null;
    }
    assert.equal((await call(['doctor'])).schema, false);
    assert.equal((await call(['migrate'])).ready, true);
    assert.equal((await call(['doctor'])).mode, 'automatic-discovery');
    const automatic = await call(['start', '--qualification']);
    assert.equal(automatic.mode, 'automatic-discovery');
    await call(['cancel', automatic.id]);
    assert.equal((await call(['settings', 'set', 'candidateLimit', '3'])).candidateLimit, 3);
    assert.equal((await call(['schedule', 'every', '90'])).intervalMinutes, 90);
    assert.equal((await call(['schedule', 'off'])).nextRunAt, null);
    await call(['sources', 'add', 'Training Journal', 'https://journal.test/feed', 'https://journal.test/terms', '--publisher', 'journal-press']);
    assert.equal((await call(['sources', 'add', 'Executive Forum', 'https://forum.test/feed', 'https://forum.test/terms', '--publisher', 'forum-press'])).independent, 2);
    const queued = await call(['start', '--qualification']);
    assert.equal(queued.mode, 'automatic-discovery');
    assert.equal((await call(['pause', queued.id])).state, 'PAUSED');
    assert.equal((await call(['resume', 'active'])).state, 'QUEUED');
    assert.equal((await call(['cancel', 'active'])).state, 'CANCELLED');
    assert.equal((await call(['wait', queued.id, '--quiet'], 4)).run.state, 'CANCELLED');
    assert.equal((await call(['evaluate', 'latest'])).investigated, 0);
    assert.deepEqual(await call(['investigations', '--run', queued.id]), []);
    assert.deepEqual(await call(['opportunities', '--run', queued.id]), []);
    assert.equal((await call(['usage', '--run', queued.id])).calls, 0);
    assert.equal((await call(['sources', 'remove', 'https://forum.test/feed'])).independent, 1);
  } finally {
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
