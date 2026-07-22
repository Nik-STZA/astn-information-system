/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output for the Cloud Run container build.
  output: "standalone",
  images: {
    remotePatterns: [],
  },
};

module.exports = nextConfig;
