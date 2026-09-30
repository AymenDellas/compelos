/** @type {import('next').NextConfig} */
module.exports = {
  poweredByHeader: false,
  turbopack: { root: __dirname },
  async headers() {
    return [{
      source: '/portal/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        { key: 'Cache-Control', value: 'private, no-store' },
      ],
    }];
  },
};
