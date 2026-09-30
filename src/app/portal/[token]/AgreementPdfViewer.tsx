'use client';

import { useEffect, useRef, useState } from 'react';

export function AgreementPdfViewer({ url }: { url: string }) {
    const pagesRef = useRef<HTMLDivElement>(null);
    const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

    useEffect(() => {
        let cancelled = false;
        setState('loading');
        pagesRef.current?.replaceChildren();
        const showPages = async () => {
            const pdfjs = await import('pdfjs-dist');
            pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
            const loadingTask = pdfjs.getDocument({ url });
            const pdf = await loadingTask.promise;
            const container = pagesRef.current;
            if (!container || cancelled) return;
            container.replaceChildren();
            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                if (cancelled) return;
                const page = await pdf.getPage(pageNumber);
                const viewport = page.getViewport({ scale: 1.5 });
                const canvas = document.createElement('canvas');
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                canvas.className = 'block w-full h-auto bg-white shadow-sm';
                canvas.setAttribute('role', 'img');
                canvas.setAttribute('aria-label', `Agreement page ${pageNumber} of ${pdf.numPages}`);
                const context = canvas.getContext('2d');
                if (!context) throw new Error('Canvas is unavailable.');
                container.appendChild(canvas);
                await page.render({ canvas, canvasContext: context, viewport }).promise;
            }
            if (!cancelled) setState('ready');
        };
        showPages().catch(() => { if (!cancelled) setState('error'); });
        return () => { cancelled = true; };
    }, [url]);

    return (
        <div className="rounded-md border border-[var(--line-strong)] bg-[var(--surface-2)] p-3 sm:p-5">
            {state === 'loading' && <p className="text-sm text-[var(--text-dim)]">Loading agreement pages…</p>}
            {state === 'error' && <p className="text-sm text-[var(--warn)]">The PDF preview could not load here. Use “Open PDF in new tab” to review it before signing.</p>}
            <div ref={pagesRef} className="space-y-4 max-h-[640px] overflow-y-auto" aria-label="Agreement PDF pages" />
            {state === 'ready' && <p className="text-xs text-[var(--text-faint)] mt-3">Scroll through every page before signing.</p>}
        </div>
    );
}
