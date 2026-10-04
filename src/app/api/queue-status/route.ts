import { requireAdmin } from '@/lib/dashboard-auth';
import { WORKER_MESSAGE } from '@/lib/worker-availability';
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET(){ await requireAdmin(); return NextResponse.json({ status: 'ok', available: false, queueSize: 0, workerStatus: null, dailyStats: { date: '', count: 0, limit: 0 }, recentResults: [], message: WORKER_MESSAGE }); }
