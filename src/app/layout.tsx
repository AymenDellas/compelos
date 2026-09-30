import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Compel client portal',
    description: 'Client onboarding with Compel',
    robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return <html lang="en"><body className="font-sans antialiased min-h-screen">{children}</body></html>;
}
