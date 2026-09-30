# Compel client portal

This is the public-facing portal only. It serves `/portal/{token}` and its agreement PDF; the internal dashboard, admin endpoints, lead tools, workers, and local content data are not included.

Clients can review every PDF page inside their portal and sign by entering their name and email and explicitly agreeing to use a typed electronic signature. The server stores the reviewed PDF, a fixed client-signed PDF, timestamp, and SHA-256 hash of the reviewed PDF in the existing project record. The client and Compel can view the saved copy immediately. Compel still needs to countersign the downloaded PDF and upload the final copy in the internal dashboard before the agreement is marked fully signed. The portal link is a bearer link, not identity verification; use a dedicated e-sign provider when verified identity or a stronger independent audit trail is required. No signature emails are sent automatically.

The portal reads and updates **the same PostgreSQL database** as the internal Compel dashboard. Create and save onboarding projects in the internal app first. A portal URL works only when that project already has a `portalToken` in its onboarding data. Share the Vercel production URL with the token path, for example `https://your-domain/portal/{token}`. Treat each link like a password: anyone with it can view and submit that client's onboarding information. To revoke one, replace the saved token in the internal app.

## Deploy on Vercel

1. Import `AymenDellas/compelos` as a Next.js project. The root directory is `/` and the build command is `npm run build`.
2. In **Project Settings → Environment Variables**, set `DATABASE_URL` for Production to the **Supabase transaction pooler** connection string from Supabase's **Connect** dialog (port `6543`). Set it for Preview too only if preview deployments need live portal access. Do not put the value in GitHub or in a public URL.
   If your Supabase project provides a database CA certificate, you can also set `DATABASE_CA_CERT` to its PEM contents to verify the TLS certificate chain. Without it, the connection is encrypted using the same certificate behavior as the internal dashboard.
3. Deploy. Open the production home page, then test one existing `/portal/{token}` URL, its agreement PDF, and a harmless onboarding-form save before sharing with a client. The internal dashboard and this deployment must point to the same database; the portal does not copy data.

In the internal dashboard, set `NEXT_PUBLIC_CLIENT_PORTAL_URL` to this deployment's production origin (for example, `https://compelos.vercel.app`) and restart/redeploy that dashboard. Its Onboarding view will then show **Copy client link** for saved projects. Do not send a `localhost` portal URL to a client.

The database schema and projects are created by the internal dashboard. The portal does not run migrations. A fresh empty database will not contain any client portals.

The source repository is public, but it intentionally contains no API keys, database passwords, `.env.local`, lead data, or client records. Keep production credentials in Vercel environment variables. Do not copy `.env.docker` from the internal dashboard repository into this one.

To run locally, copy `.env.example` to `.env.local`, enter a database URL, then run `npm install` and `npm run dev`. Node.js 22 is required. The PDF viewer uses a version-matched PDF.js worker copied into `public/` from the pinned `pdfjs-dist` package; update both files together when upgrading that package.
