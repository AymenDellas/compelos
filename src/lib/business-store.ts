import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from './pg_setup';

// The internal dashboard owns schema creation and project setup. This portal
// receives only the existing project's token and can update portal fields.
export async function businessTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function recordActivity(client: PoolClient, opportunityId: string, kind: string, note: string): Promise<void> {
    await client.query('INSERT INTO business_activities(id,opportunity_id,kind,note) VALUES ($1,$2,$3,$4)', [
        randomUUID(), opportunityId, kind, note,
    ]);
}
