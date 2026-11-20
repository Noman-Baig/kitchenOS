/** @type {import('next').NextConfig} */
const backend = process.env.BACKEND_URL || 'http://192.168.100.198:4000';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self), usb=(self), bluetooth=(self)' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
    // Use frontend directory as the tracing root
  outputFileTracingRoot: process.cwd(),

  allowedDevOrigins: ['192.168.100.198'],
  skipTrailingSlashRedirect: true,
  output: 'standalone',
  images: { unoptimized: true },
  async rewrites() {
    // In production a reverse proxy routes /api and /socket.io to the backend directly; these rewrites cover single-host setups and development.
    return {
      // HTTP long-polling transport for socket.io when no reverse proxy is present (WebSocket upgrades need the proxy or NEXT_PUBLIC_SOCKET_URL)
      beforeFiles: [{ source: '/realtime', destination: `${backend}/realtime` }],
      afterFiles: [{ source: '/api/:path*', destination: `${backend}/api/:path*` }],
      fallback: [],
    };
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default nextConfig;
