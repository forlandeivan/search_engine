/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination:
          'https://search-engine-backend-git-dev-ivans-projects-b95f0de9.vercel.app/api/:path*',
      },
    ];
  },
};
module.exports = nextConfig;
