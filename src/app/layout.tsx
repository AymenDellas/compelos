import type { Metadata } from "next";
import "./globals.css";
import "./overview.css";

export const metadata: Metadata = {
    title: "Compel",
    description: "Lead qualification and signal discovery",
    robots: { index: false, follow: false },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="font-sans antialiased min-h-screen selection:bg-[var(--signal-dim)]">
                {children}
            </body>
        </html>
    );
}
