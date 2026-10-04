import { requireAdmin } from '@/lib/dashboard-auth';
import { WORKER_MESSAGE } from '@/lib/worker-availability';
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET(){ await requireAdmin(); return NextResponse.json({status:'offline',workerOnline:false,message:WORKER_MESSAGE}); }
export async function POST(){ await requireAdmin(); return NextResponse.json({error:WORKER_MESSAGE},{status:503}); }
