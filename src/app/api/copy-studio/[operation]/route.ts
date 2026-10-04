import { requireAdmin } from '@/lib/dashboard-auth';
import { handleCopyStudio } from '@/lib/copy-studio/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Context = { params: Promise<{ operation: string }> };
export async function GET(request: Request, context: Context) {
    await requireAdmin();
  return handleCopyStudio(request, (await context.params).operation);
}
export async function POST(request: Request, context: Context) {
    await requireAdmin();
  return handleCopyStudio(request, (await context.params).operation);
}
