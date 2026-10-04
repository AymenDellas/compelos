/** @type {import('next').NextConfig} */
module.exports = {
  poweredByHeader: false,
  serverExternalPackages: ['imapflow', '@qwen-code/qwen-code'],
  outputFileTracingIncludes: { '/api/copy-studio/*': ['./node_modules/@qwen-code/qwen-code/**/*'] },
  outputFileTracingExcludes: { '*': ['**/.env*', '**/.git/**', '**/tmp/**', '**/output/**', '**/data/**', '**/progress/**'] },
  experimental: { serverActions: { bodySizeLimit: '10mb' } },
  turbopack: { root: __dirname },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
      ],
    }];
  },
};
