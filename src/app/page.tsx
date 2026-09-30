export default function Home() {
    return (
        <main className="min-h-screen grid place-items-center p-6 bg-[var(--surface-0)]">
            <div className="panel p-8 max-w-md w-full text-center">
                <span className="inline-flex w-10 h-10 rounded-lg bg-[var(--signal)] text-white items-center justify-center font-bold" aria-hidden>C</span>
                <h1 className="text-xl font-semibold mt-5">Compel client portal</h1>
                <p className="text-sm text-[var(--text-dim)] mt-2">Open the private portal link sent by your Compel project contact.</p>
            </div>
        </main>
    );
}
