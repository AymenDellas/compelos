import { requireAdmin } from './dashboard-auth';
export async function requireWorkerAdmin() { await requireAdmin(); }
