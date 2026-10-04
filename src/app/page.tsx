import Dashboard from "@/components/Dashboard";
import { adminSession } from '@/lib/dashboard-auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Home() {
    if (!await adminSession()) redirect('/login');
    return (
        <main className="min-h-screen p-4 md:p-8">
            <Dashboard />
        </main>
    );
}
