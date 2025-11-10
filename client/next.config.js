/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL;
    return base ? [{ source: '/api/:path*', destination: `${base}/api/:path*` }] : [];
  },
};
module.exports = nextConfig;
