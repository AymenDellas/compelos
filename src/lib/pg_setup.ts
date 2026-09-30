import { Pool } from 'pg';

// A warm Vercel function should keep at most one database connection.
// Supabase's shared pooler has a self-signed certificate chain. If its CA is
// configured, validate the chain; otherwise keep the existing TLS behavior.
const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
});
