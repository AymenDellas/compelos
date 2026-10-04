# Compel workspace and client portals

The full Compel dashboard is served at `/` behind a password-only login. Existing client links at `/portal/{token}` remain accessible without the admin password. Internal API routes and server actions verify a signed, expiring session against the database. Sign out revokes that session. Login attempts are limited in the database, including across Vercel instances. Admin pages and client portals are excluded from search indexing.

Production requires `DATABASE_URL`, `DASHBOARD_PASSWORD_HASH` (scrypt:salt:hash), and a randomly generated `DASHBOARD_SESSION_SECRET` of at least 32 characters. Store them as Vercel Production secrets; never put a plaintext password or credentials in the source. Missing authentication configuration fails closed. Sessions last eight hours. Changing the stored password hash invalidates existing cookies. This is a single shared workspace password, so anyone who knows it has admin access.

CRM, onboarding, discovery calls, and Create data use PostgreSQL. Create and saved runs persist across deployments; content edits run in database transactions. Copy Studio is included with its existing AI client integration. Configure only needed server integration credentials in Vercel. The local source app is separate and does not automatically sync its file-based Create data after the initial migration.

Background LinkedIn scraping and lead discovery are intentionally unavailable in this Vercel deployment until an always-on worker is connected. Their routes return a clear unavailable response instead of accepting jobs that cannot run. Existing CRM and prospect records remain available. The persistent browser worker setup belongs on a separate computer or server.

Clients can review every PDF page inside their portal and sign by entering their name and email and explicitly agreeing to use a typed electronic signature. The server stores the reviewed PDF, a fixed client-signed PDF, timestamp, and SHA-256 hash of the reviewed PDF in the existing project record. The client and Compel can view the saved copy immediately. Compel still needs to countersign the downloaded PDF and upload the final copy in the internal dashboard before the agreement is marked fully signed. The portal link is a bearer link, not identity verification; use a dedicated e-sign provider when verified identity or a stronger independent audit trail is required. No signature emails are sent automatically.

The portal reads and updates **the same PostgreSQL database** as the internal Compel dashboard. Create and save onboarding projects in the internal app first. A portal URL works only when that project already has a `portalToken` in its onboarding data. Share the Vercel production URL with the token path, for example `https://your-domain/portal/{token}`. Treat each link like a password: anyone with it can view and submit that client's onboarding information. To revoke one, replace the saved token in the internal app.

## Deploy on Vercel

1. Import `AymenDellas/compelos` as a Next.js project. The root directory is `/` and the build command is `npm run build`.
2. In **Project Settings → Environment Variables**, set `DATABASE_URL` for Production to the **Supabase transaction pooler** connection string from Supabase's **Connect** dialog (port `6543`). Set it for Preview too only if preview deployments need live portal access. Do not put the value in GitHub or in a public URL.
   If your Supabase project provides a database CA certificate, you can also set `DATABASE_CA_CERT` to its PEM contents to verify the TLS certificate chain. Without it, the connection is encrypted using the same certificate behavior as the internal dashboard.
3. Configure the password hash and session secret above, then deploy. Verify the password login, rejection of unauthenticated admin requests, sign out, and an existing client portal and PDF. The local dashboard and this deployment must point to the same database.

In the internal dashboard, set `NEXT_PUBLIC_CLIENT_PORTAL_URL` to this deployment's production origin (for example, `https://compelos.vercel.app`) and restart/redeploy that dashboard. Its Onboarding view will then show **Copy client link** for saved projects. Do not send a `localhost` portal URL to a client.

Business schemas are created by the authenticated dashboard. A fresh empty database will not contain any existing client portals.

The source repository is public, but it intentionally contains no API keys, database passwords, `.env.local`, lead data, or client records. Keep production credentials in Vercel environment variables. Do not copy `.env.docker` from the internal dashboard repository into this one.

To run locally, copy `.env.example` to `.env.local`, enter a database URL, then run `npm install` and `npm run dev`. Node.js 22 is required. The PDF viewer uses a version-matched PDF.js worker copied into `public/` from the pinned `pdfjs-dist` package; update both files together when upgrading that package.
