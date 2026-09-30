import Link from 'next/link';

export default function NotFound() {
    return <main className="min-h-screen grid place-items-center p-6"><div className="panel p-8 max-w-md w-full text-center"><h1 className="text-xl font-semibold">Portal link unavailable</h1><p className="text-sm text-[var(--text-dim)] mt-2">Check the link you received or ask your Compel project contact for a new one.</p><Link className="btn btn-outline mt-5" href="/">Back to portal</Link></div></main>;
}
