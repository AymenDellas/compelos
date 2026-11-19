export const schema = `
CREATE TABLE IF NOT EXISTS origin_settings (
  id integer PRIMARY KEY CHECK (id=1),
  config jsonb NOT NULL,
  next_run_at timestamptz,
  worker_seen_at timestamptz
);
CREATE TABLE IF NOT EXISTS origin_runs (
  id uuid PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('QUEUED','RUNNING','PAUSED','COMPLETED','CANCELLED','FAILED')),
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  deadline_at timestamptz,
  paused_at timestamptz,
  finished_at timestamptz,
  lease uuid,
  lease_until timestamptz,
  control_revision integer NOT NULL DEFAULT 0,
  sources jsonb,
  error text
);
CREATE UNIQUE INDEX IF NOT EXISTS origin_one_active_run ON origin_runs ((1)) WHERE state IN ('QUEUED','RUNNING','PAUSED');
CREATE TABLE IF NOT EXISTS origin_businesses (
  id uuid PRIMARY KEY,
  domain text NOT NULL UNIQUE,
  name text NOT NULL,
  website text NOT NULL,
  seed jsonb NOT NULL,
  signature jsonb,
  investigated_at timestamptz
);
CREATE TABLE IF NOT EXISTS origin_identity_keys (
  key text PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES origin_businesses(id),
  provenance jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS origin_investigations (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES origin_runs(id),
  business_id uuid NOT NULL REFERENCES origin_businesses(id),
  seeds jsonb NOT NULL,
  stage text NOT NULL CHECK (stage IN ('RESOLVING','INVESTIGATING','VERIFYING','COMPLETED','FAILED')),
  checkpoint jsonb NOT NULL,
  decision jsonb,
  outcome text CHECK (outcome IN ('QUALIFIED','UNRESOLVED','REJECTED')),
  expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,business_id)
);
CREATE INDEX IF NOT EXISTS origin_investigations_business ON origin_investigations (business_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS origin_investigations_run_stage ON origin_investigations (run_id,stage,created_at);
CREATE TABLE IF NOT EXISTS origin_artifacts (
  investigation_id uuid NOT NULL REFERENCES origin_investigations(id),
  id text NOT NULL,
  digest text NOT NULL,
  url text NOT NULL,
  device text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  image bytea,
  PRIMARY KEY(investigation_id,id)
);
CREATE TABLE IF NOT EXISTS origin_model_usage (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES origin_runs(id),
  investigation_id uuid NOT NULL REFERENCES origin_investigations(id),
  cache_key text NOT NULL,
  model text NOT NULL,
  reserved_cents integer NOT NULL CHECK (reserved_cents > 0),
  provider_cents numeric,
  input_bytes integer NOT NULL,
  output_limit integer NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  retry_at timestamptz,
  status text NOT NULL DEFAULT 'RESERVED',
  result jsonb,
  UNIQUE(investigation_id,cache_key,attempt)
);
CREATE INDEX IF NOT EXISTS origin_model_usage_recent ON origin_model_usage(created_at DESC);
`;
