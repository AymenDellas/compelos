import { redirect } from 'next/navigation';
import { adminSession } from '@/lib/dashboard-auth';
import { LoginForm } from './LoginForm';
export const dynamic = 'force-dynamic';
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = typeof params.next === 'string' && params.next.startsWith('/') && !params.next.startsWith('//') && !params.next.includes('\\') && !params.next.startsWith('/login') ? params.next : '/';
  if (await adminSession()) redirect(next);
  return <main className="min-h-screen flex items-center justify-center px-5 py-12 bg-[var(--surface-0)]">
    <section className="w-full max-w-sm">
      <div className="flex items-center gap-3 mb-10"><span className="w-10 h-10 rounded-xl bg-[var(--signal)] text-white flex items-center justify-center text-xl font-bold" aria-hidden>C</span><span className="text-xl font-semibold tracking-tight">Compel</span></div>
      <p className="label-micro">Private workspace</p>
      <h1 className="text-3xl font-semibold tracking-tight mt-3">Welcome back.</h1>
      <p className="text-[var(--text-dim)] text-sm leading-relaxed mt-3">Enter your password to open the dashboard.</p>
      <LoginForm next={next} />
      <p className="text-xs text-[var(--text-faint)] leading-relaxed mt-7">If you’re a client, open the private portal link sent by your Compel contact.</p>
    </section>
  </main>;
}
