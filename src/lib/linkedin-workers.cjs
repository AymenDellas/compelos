'use strict';

// Shared by Next.js and the persistent worker. Vercel never stores queue files
// or launches browsers: the database carries settings, leases and results.
const { randomUUID, randomBytes, createCipheriv, createDecipheriv, createHash } = require('node:crypto');
const {cleanIdentity}=require('./linkedin-session-identity.cjs');
const ready = new WeakMap();
// Browser text can contain lone UTF-16 surrogates or NULs. PostgreSQL JSONB
// rejects those even though JSON.stringify accepts them. Keep normal emoji.
function json(value) { return JSON.stringify(value, (_key,item)=>typeof item==='string'?item.toWellFormed().replace(/\u0000/g,''):item); }
const SCHEMA = `
CREATE TABLE IF NOT EXISTS compel_worker_config (id INTEGER PRIMARY KEY CHECK(id=1), active_count INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0);
INSERT INTO compel_worker_config(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS compel_linkedin_accounts (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, email TEXT NOT NULL, secret TEXT NOT NULL DEFAULT '',
 profile_key TEXT UNIQUE NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, archived BOOLEAN NOT NULL DEFAULT FALSE,
 daily_limit INTEGER NOT NULL DEFAULT 400 CHECK(daily_limit BETWEEN 1 AND 400), position INTEGER NOT NULL,
 login_requested_at TIMESTAMPTZ, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE UNIQUE INDEX IF NOT EXISTS compel_linkedin_active_email ON compel_linkedin_accounts(lower(email)) WHERE archived IS FALSE;
CREATE TABLE IF NOT EXISTS compel_worker_usage (account_id TEXT NOT NULL, day DATE NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account_id,day));
CREATE TABLE IF NOT EXISTS compel_worker_sessions (account_id TEXT PRIMARY KEY, owner TEXT NOT NULL, lease_until TIMESTAMPTZ NOT NULL, status JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS compel_worker_jobs (
 id TEXT PRIMARY KEY, profile_key TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 account_id TEXT, owner TEXT, lease_until TIMESTAMPTZ, result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ);
ALTER TABLE compel_worker_jobs ADD COLUMN IF NOT EXISTS queue_order BIGSERIAL;
CREATE UNIQUE INDEX IF NOT EXISTS compel_worker_pending_profile ON compel_worker_jobs(profile_key) WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS compel_worker_job_queue ON compel_worker_jobs(created_at) WHERE status IN ('pending','processing');
`;
async function ensure(pool) {
 if (!ready.has(pool)) ready.set(pool, pool.query(SCHEMA).catch(error => { ready.delete(pool); throw error; }));
 return ready.get(pool);
}
function encryptionKey(env = process.env, legacy = false) {
 let material = env.LINKEDIN_CREDENTIAL_KEY || env.DATABASE_URL;
 if (!material || material.length < 32) throw new Error('Account credential storage is not configured.');
 // Supabase uses distinct ports for persistent and transaction-pooled clients.
 // Credentials entered on Vercel must decrypt on the persistent worker too.
 if (!legacy && !env.LINKEDIN_CREDENTIAL_KEY) {
  const database = new URL(material); database.port = ''; material = database.toString();
 }
 return createHash('sha256').update('compel/linkedin-credentials/v1\0').update(material).digest();
}
function encrypt(password, env) {
 const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
 const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
 return 'v2.' + [iv,cipher.getAuthTag(),encrypted].map(value=>value.toString('base64url')).join('.');
}
function decrypt(secret, env) {
 if (!secret) return '';
 const version2 = secret.startsWith('v2.');
 const [iv, tag, encrypted] = (version2 ? secret.slice(3) : secret).split('.').map(value => Buffer.from(value, 'base64url'));
 const cipher = createDecipheriv('aes-256-gcm', encryptionKey(env,!version2), iv); cipher.setAuthTag(tag);
 return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
}
function profileUrl(value) {
 try {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com$/.test(url.hostname) || url.username || url.password) return null;
  const match = url.pathname.match(/^\/in\/([^/]+)\/?$/);
  return match ? `https://www.linkedin.com/in/${match[1].toLowerCase()}/` : null;
 } catch { return null; }
}
function validateSettings(body) {
 if (!body || !Array.isArray(body.accounts) || body.accounts.length > 10 || !Number.isInteger(body.revision) || body.revision < 0) throw new Error('Invalid account settings.');
 const ids = new Set(), emails = new Set();
 const accounts = body.accounts.map((a, position) => {
  if (!a || typeof a.email !== 'string' || typeof a.label !== 'string' || typeof a.enabled !== 'boolean') throw new Error('Each account needs a name, email and enabled setting.');
  const email = a.email.trim().toLowerCase(), label = a.label.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255 || !label || label.length > 80) throw new Error('Enter a valid LinkedIn email and a name of up to 80 characters.');
  if (emails.has(email)) throw new Error('This LinkedIn account is listed twice.'); emails.add(email);
  if (!Number.isInteger(a.dailyLimit) || a.dailyLimit < 1 || a.dailyLimit > 400) throw new Error('Daily limits must be between 1 and 400 profiles per account.');
  if (a.id && (typeof a.id !== 'string' || !/^(?:legacy-\d+|[a-f0-9-]{36})$/.test(a.id) || ids.has(a.id))) throw new Error('Invalid or repeated account ID.');
  if (a.id) ids.add(a.id);
  if (a.password !== undefined && (typeof a.password !== 'string' || a.password.length > 256)) throw new Error('Invalid password.');
  if (!a.id && !a.password) throw new Error('Enter the password for the new account.');
  return { id: a.id || randomUUID(), email, label, enabled: a.enabled, dailyLimit: a.dailyLimit, password: a.password || '', position };
 });
 const enabled = accounts.filter(a => a.enabled).length;
 if (!Number.isInteger(body.activeCount) || body.activeCount < 0 || body.activeCount > enabled) throw new Error('Choose a number of running accounts between 0 and the number enabled.');
 return { accounts, activeCount: body.activeCount, revision: body.revision };
}
async function settings(pool) {
 await ensure(pool);
 const config = (await pool.query('SELECT * FROM compel_worker_config WHERE id=1')).rows[0];
 const rows = (await pool.query(`SELECT a.id,a.label,a.email,a.enabled,a.daily_limit,a.position,(a.secret<>'') AS has_password,
  a.login_requested_at,s.status,s.updated_at,s.lease_until,COALESCE(u.count,0) AS daily_count
  FROM compel_linkedin_accounts a LEFT JOIN compel_worker_sessions s ON s.account_id=a.id
  LEFT JOIN compel_worker_usage u ON u.account_id=a.id AND u.day=(NOW() AT TIME ZONE 'UTC')::date
  WHERE a.archived IS FALSE ORDER BY a.position,a.id`)).rows;
 return { revision: config.revision, activeCount: Math.min(config.active_count, rows.filter(a => a.enabled).length), accounts: rows.map(a => ({
  id:a.id,label:a.label,email:a.email,enabled:a.enabled,dailyLimit:a.daily_limit,hasPassword:a.has_password,
  dailyCount:a.daily_count,status:a.status?.status || 'offline',reason:a.status?.reason || '',
  online:!!a.lease_until && new Date(a.lease_until).getTime() > Date.now(),
  loginPending:!!a.login_requested_at, updatedAt:a.updated_at || null,
  memoryMB:a.status?.memoryMB || 0,avgJobDurationMs:a.status?.avgJobDurationMs || 0,url:a.status?.url || '',
  signedIn:cleanIdentity(a.status?.signedIn),
 })) };
}
async function saveSettings(pool, body) {
 const value = validateSettings(body); await ensure(pool);
 const client = await pool.connect();
 try {
  await client.query('BEGIN');
  const config = (await client.query('SELECT * FROM compel_worker_config WHERE id=1 FOR UPDATE')).rows[0];
  if (config.revision !== value.revision) throw new Error('Account settings changed in another window. Reload before saving.');
  const existing = (await client.query('SELECT * FROM compel_linkedin_accounts')).rows;
  for (const a of value.accounts) {
   let before = existing.find(row => row.id === a.id && !row.archived);
   if (!before && body.accounts.some(row => row.id === a.id)) throw new Error('This account no longer exists. Reload before saving.');
   // Re-adding the same identity restores its profile and daily usage; removing
   // and adding an account cannot silently reset its daily budget.
   if (!before) { before=existing.find(row=>row.email.toLowerCase()===a.email); if(before)a.id=before.id; }
   // A login identity cannot inherit a different identity's cookie directory.
   if (before && before.email.toLowerCase() !== a.email) throw new Error('Add a new account to change its LinkedIn email.');
   const secret = a.password ? encrypt(a.password) : before?.secret;
   if (!secret) throw new Error('Enter an account password.');
   await client.query(`INSERT INTO compel_linkedin_accounts(id,label,email,secret,profile_key,enabled,daily_limit,position)
    VALUES($1,$2,$3,$4,$1,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET label=$2,secret=$4,enabled=$5,daily_limit=$6,position=$7,archived=FALSE,
    changed_at=CASE WHEN compel_linkedin_accounts.secret IS DISTINCT FROM $4 THEN NOW() ELSE compel_linkedin_accounts.changed_at END`,
    [a.id,a.label,a.email,secret,a.enabled,a.dailyLimit,a.position]);
  }
  await client.query('UPDATE compel_linkedin_accounts SET archived=TRUE,enabled=FALSE WHERE archived IS FALSE AND NOT(id=ANY($1::text[]))', [value.accounts.map(a => a.id)]);
  await client.query('UPDATE compel_worker_config SET active_count=$1,revision=revision+1 WHERE id=1', [value.activeCount]);
  await client.query('COMMIT');
 } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
 return settings(pool);
}
async function importAccounts(pool, accounts, legacyUsage) {
 await ensure(pool);
 // One transaction makes startup import safe against a dashboard edit or a
 // second supervisor. Environment credentials are never a source of overwrites.
 const client = await pool.connect();
 try {
  await client.query('BEGIN'); await client.query('SELECT id FROM compel_worker_config WHERE id=1 FOR UPDATE');
  const count = (await client.query('SELECT count(*)::integer AS n FROM compel_linkedin_accounts')).rows[0].n;
  if (!count) {
   for (const [index, a] of accounts.slice(0,10).entries()) {
    if (!a.email || !a.password) continue;
    await client.query(`INSERT INTO compel_linkedin_accounts(id,label,email,secret,profile_key,position) VALUES($1,$2,$3,$4,$5,$6)`,
     [`legacy-${index}`,`Account ${index+1}`,a.email.trim().toLowerCase(),encrypt(a.password),index===0?'account-0':`legacy-${index}`,index]);
   }
   if (accounts.length && legacyUsage?.date && Number.isInteger(legacyUsage.count))
    await client.query('INSERT INTO compel_worker_usage(account_id,day,count) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', ['legacy-0',legacyUsage.date,legacyUsage.count]);
  }
  await client.query('COMMIT');
 } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function selectedAccounts(pool) {
 await ensure(pool);
 return (await pool.query(`SELECT a.* FROM compel_linkedin_accounts a WHERE a.enabled IS TRUE AND a.archived IS FALSE
  ORDER BY a.position,a.id LIMIT (SELECT active_count FROM compel_worker_config WHERE id=1)`)).rows;
}
async function acquireSession(pool, id, owner) {
 await ensure(pool);
 return (await pool.query(`INSERT INTO compel_worker_sessions(account_id,owner,lease_until,status) VALUES($1,$2,NOW()+interval '120 seconds','{"status":"starting"}')
  ON CONFLICT(account_id) DO UPDATE SET owner=$2,lease_until=NOW()+interval '120 seconds',status='{"status":"starting"}',updated_at=NOW()
  WHERE compel_worker_sessions.lease_until<NOW() OR compel_worker_sessions.owner=$2 RETURNING account_id`,[id,owner])).rowCount === 1;
}
async function heartbeat(pool, id, owner, status) {
 const update = await pool.query(`UPDATE compel_worker_sessions SET lease_until=NOW()+interval '120 seconds',status=$3::jsonb,updated_at=NOW() WHERE account_id=$1 AND owner=$2 AND lease_until>NOW()`,[id,owner,json(status)]);
 if (!update.rowCount) throw new Error('Account session lease lost; stopping this browser.');
 await pool.query(`UPDATE compel_worker_jobs SET lease_until=NOW()+interval '15 minutes' WHERE account_id=$1 AND owner=$2 AND status='processing'`,[id,owner]);
}
async function releaseSession(pool,id,owner,status) {
 await pool.query('UPDATE compel_worker_sessions SET lease_until=NOW(),status=$3::jsonb,updated_at=NOW() WHERE account_id=$1 AND owner=$2',[id,owner,json(status)]);
 await pool.query(`UPDATE compel_worker_jobs SET status='pending',owner=NULL,account_id=NULL,lease_until=NULL WHERE account_id=$1 AND owner=$2 AND status='processing'`,[id,owner]);
}
async function requestLogin(pool,id) {
 await ensure(pool);
 const result = await pool.query('UPDATE compel_linkedin_accounts SET login_requested_at=NOW() WHERE id=$1 AND archived IS FALSE RETURNING id',[id]);
 if (!result.rowCount) throw new Error('Account not found.');
}
async function consumeLoginRequest(pool,id,token) {
 // Use PostgreSQL's exact text timestamp. A JavaScript Date discards the
 // microseconds, so comparing it to the original timestamp never clears it.
 if (!token) return false;
 const result=await pool.query('UPDATE compel_linkedin_accounts SET login_requested_at=NULL WHERE id=$1 AND login_requested_at=$2::timestamptz',[id,token]);
 return result.rowCount===1;
}
async function enqueue(pool, urls, options = {}) {
 await ensure(pool); const entries=[], skipped=[];
 if (!Array.isArray(urls) || urls.length > 5000) throw new Error('Submit up to 5,000 LinkedIn profiles.');
 if(options.jobId && urls.length!==1)throw new Error('A recovered job must contain one profile.');
 for (const value of urls) {
  const url = typeof value === 'string' ? profileUrl(value) : null;
  if (!url) { skipped.push({url:value,reason:'Invalid LinkedIn person profile'}); continue; }
  const id = options.jobId || `job_${randomUUID()}`;
  const payload={jobId:id,linkedinUrl:url,nativePostProcess:options.nativePostProcess!==false,targetRegion:options.targetRegion||'na',createdAt:new Date().toISOString()};
  entries.push({id,profile_key:url,payload});
 }
 if(!entries.length)return{jobs:[],queuedCount:0,skipped,queued:[]};
 const result=await pool.query(`INSERT INTO compel_worker_jobs(id,profile_key,payload)
  SELECT entry.id,entry.profile_key,entry.payload FROM jsonb_to_recordset($1::jsonb) AS entry(id TEXT,profile_key TEXT,payload JSONB)
  ON CONFLICT DO NOTHING RETURNING id`,[json(entries)]);
 const inserted=new Set(result.rows.map(row=>row.id));
 const queued=entries.filter(entry=>inserted.has(entry.id)).map(entry=>({id:entry.id,url:entry.profile_key}));
 for(const entry of entries)if(!inserted.has(entry.id))skipped.push({url:entry.profile_key,reason:'Already queued'});
 const jobs=queued.map(entry=>entry.id);
 return {jobs,queuedCount:jobs.length,skipped,queued};
}
async function claim(pool,id,owner) {
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const account=(await client.query(`SELECT a.* FROM compel_linkedin_accounts a WHERE a.id=$1 AND a.enabled IS TRUE AND a.archived IS FALSE
   AND a.id IN (SELECT id FROM compel_linkedin_accounts WHERE enabled IS TRUE AND archived IS FALSE ORDER BY position,id LIMIT(SELECT active_count FROM compel_worker_config WHERE id=1)) FOR SHARE`,[id])).rows[0];
  if (!account) { await client.query('COMMIT'); return {disabled:true}; }
  const session=(await client.query('SELECT account_id FROM compel_worker_sessions WHERE account_id=$1 AND owner=$2 AND lease_until>NOW() FOR UPDATE',[id,owner])).rows[0];
  if (!session) throw new Error('Account session lease lost.');
  await client.query(`INSERT INTO compel_worker_usage(account_id,day) VALUES($1,(NOW() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING`,[id]);
  const usage=(await client.query(`SELECT count FROM compel_worker_usage WHERE account_id=$1 AND day=(NOW() AT TIME ZONE 'UTC')::date FOR UPDATE`,[id])).rows[0];
  if (usage.count >= account.daily_limit) { await client.query('COMMIT'); return {limited:true,dailyCount:usage.count,dailyLimit:account.daily_limit}; }
  const job=(await client.query(`SELECT * FROM compel_worker_jobs WHERE status='pending' OR (status='processing' AND lease_until<NOW()) ORDER BY created_at,queue_order FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
  if (!job) { await client.query('COMMIT'); return null; }
  await client.query(`UPDATE compel_worker_jobs SET status='processing',account_id=$2,owner=$3,lease_until=NOW()+interval '15 minutes' WHERE id=$1`,[job.id,id,owner]);
  await client.query(`UPDATE compel_worker_usage SET count=count+1 WHERE account_id=$1 AND day=(NOW() AT TIME ZONE 'UTC')::date`,[id]);
  await client.query('COMMIT'); return {job:job.payload,dailyCount:usage.count+1,dailyLimit:account.daily_limit};
 } catch(error) { await client.query('ROLLBACK'); throw error; } finally {client.release();}
}
async function complete(pool,id,owner,result) {
 const update=await pool.query(`UPDATE compel_worker_jobs SET status='done',result=$3::jsonb,completed_at=NOW(),lease_until=NULL WHERE id=$1 AND owner=$2 AND status='processing' AND lease_until>NOW()`,[id,owner,json(result)]);
 if (!update.rowCount) throw new Error('Job lease lost; result was not overwritten.');
}
async function jobStatus(pool,id) {
 await ensure(pool);
 const job=(await pool.query('SELECT status,result FROM compel_worker_jobs WHERE id=$1',[id])).rows[0];
 return !job ? {jobId:id,status:'not_found'} : {jobId:id,status:job.status==='pending'?'queued':job.status,result:job.result};
}
async function clearQueue(pool) {
 await ensure(pool);
 // In-flight work keeps its lease and can finish saving.
 return (await pool.query(`UPDATE compel_worker_jobs SET status='cancelled',completed_at=NOW() WHERE status='pending'`)).rowCount;
}
function normalizeResult(result) {
 if (!result?.prospectQualification?.research || result.status==='ERROR') return result;
 try {
  const q=require('./prospect-qualification.cjs');
  const email=result.primaryEmail || result.emails?.[0] || '';
  const assessment=q.assessProspect(result.prospectQualification.baseResearch || result.prospectQualification.research,{email});
  return {...result,prospectQualification:assessment,status:q.pipelineForAssessment(assessment)==='QUALIFIED'?'QUALIFIED':'REJECTED'};
 }catch{return {...result,status:'REJECTED'};}
}
async function importResult(pool,id,wrapper) {
 if (!/^job_[a-zA-Z0-9_-]+$/.test(id) || !wrapper?.result || !wrapper.completedAt || !Number.isFinite(Date.parse(wrapper.completedAt))) return;
 const url=profileUrl(wrapper.result.url);if(!url)return;
 const result=normalizeResult(wrapper.result);
 await pool.query(`INSERT INTO compel_worker_jobs(id,profile_key,payload,status,result,completed_at,created_at)
  VALUES($1,$2,$3::jsonb,'done',$4::jsonb,$5,$5) ON CONFLICT(id) DO NOTHING`,[id,url,json({jobId:id,linkedinUrl:url}),json(result),wrapper.completedAt]);
}
async function queueStatus(pool) {
 const config=await settings(pool);
 const rows=(await pool.query(`SELECT count(*) FILTER(WHERE status IN ('pending','processing'))::integer AS pending FROM compel_worker_jobs`)).rows[0];
 const recent=(await pool.query(`SELECT id,result,completed_at FROM compel_worker_jobs WHERE status='done' ORDER BY completed_at DESC LIMIT 100`)).rows;
 const selected=config.accounts.filter(a=>a.enabled).slice(0,config.activeCount);
 const live=selected.filter(a=>a.online), busy=live.find(a=>a.status==='processing');
 const dailyCount=Number((await pool.query("SELECT COALESCE(sum(count),0)::integer AS total FROM compel_worker_usage WHERE day=(NOW() AT TIME ZONE 'UTC')::date")).rows[0].total);
 const dailyLimit=selected.reduce((sum,a)=>sum+a.dailyLimit,0);
 let today=(await pool.query(`SELECT count(*) FILTER(WHERE result->>'status'='QUALIFIED')::integer AS qualified,
  count(*) FILTER(WHERE result->>'status'='REJECTED')::integer AS rejected FROM compel_worker_jobs WHERE status='done' AND completed_at>=(NOW() AT TIME ZONE 'UTC')::date`)).rows[0];
 // CRM outcomes include results saved before the database queue was installed.
 try {today=(await pool.query(`SELECT count(*) FILTER(WHERE pipeline_status='QUALIFIED' AND NULLIF(trim(email),'') IS NOT NULL)::integer AS qualified,
  count(*) FILTER(WHERE pipeline_status='NOT_QUALIFIED')::integer AS rejected FROM leads WHERE prospect_researched_at>=((NOW() AT TIME ZONE 'UTC')::date AT TIME ZONE 'UTC')`)).rows[0];} catch { /* an older database has not received research columns yet */ }
 const ratePerHour=live.reduce((sum,a)=>sum+(a.avgJobDurationMs?Math.round(3600000/a.avgJobDurationMs):0),0);
 return {status:'ok',available:true,queueSize:rows.pending,accounts:config.accounts,activeCount:config.activeCount,
  workerStatus:{status:busy?'processing':live.length?'ready':selected.some(a=>a.status==='paused')?'paused':'offline',stale:!live.length,
   dailyCount,dailyLimit,dailyQualified:today.qualified,dailyRejected:today.rejected,activeAccounts:live.length,configuredAccounts:selected.length,
   memoryMB:live.reduce((sum,a)=>sum+a.memoryMB,0),ratePerHour:ratePerHour||null,url:busy?.url||'',
   dailyBudgetCount:selected.reduce((sum,a)=>sum+a.dailyCount,0),dailyRemaining:selected.reduce((sum,a)=>sum+Math.max(0,a.dailyLimit-a.dailyCount),0)},
  dailyStats:{date:new Date().toISOString().slice(0,10),count:dailyCount,limit:dailyLimit},
  recentResults:recent.map(row=>({jobId:row.id,result:normalizeResult(row.result),completedAt:row.completed_at}))};
}
module.exports={SCHEMA,ensure,encrypt,decrypt,profileUrl,validateSettings,settings,saveSettings,importAccounts,selectedAccounts,acquireSession,heartbeat,releaseSession,requestLogin,consumeLoginRequest,enqueue,claim,complete,jobStatus,clearQueue,queueStatus,importResult,json};
