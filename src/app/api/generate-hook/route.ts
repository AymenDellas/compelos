import { requireAdmin } from '@/lib/dashboard-auth';
import { NextResponse } from 'next/server';

export async function POST() {
    await requireAdmin();
    return NextResponse.json({error:'AI hook generation is disabled.'},{status:409});
}
