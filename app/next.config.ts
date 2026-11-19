import path from 'node:path';
import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV === 'development';

// A public site whose pages load nothing from another origin except the visitor count (an image request to
// stats.datasteg.com). `next dev` also needs eval for React's error overlay.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://stats.datasteg.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  output: 'standalone',
  // The design system lives one folder up (money-flow/design), so the project root is money-flow/.
  outputFileTracingRoot: path.join(__dirname, '..'),
  turbopack: { root: path.join(__dirname, '..') },
  // The release store is read at run time from SITE_DIR (lib/data.ts), never bundled or traced.
  outputFileTracingExcludes: { '*': ['../release/**', '../site/**'] },
  images: { unoptimized: true },
  allowedDevOrigins: ['127.0.0.1'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        // No X-Robots-Tag any more: the site is open to search engines (robots.ts and the
        // layout's robots metadata say what may be indexed).
        source: '/((?!_next/static).*)',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        // The HTML of the pages (force-dynamic, data change at most daily): five minutes in a shared cache, a day
        // stale while revalidating. Not /health, and not the bare /{lang}, which redirects by cookie.
        source: '/:lang(en|ko)/:path+',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=86400' }],
      },
    ];
  },
  env: {
    APP_VERSION: process.env.APP_VERSION ?? 'dev',
    BUILD_TIME: process.env.BUILD_TIME ?? new Date().toISOString(),
  },
};

export default config;
