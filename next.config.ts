import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // In development, proxy API requests to the local backend server
  // to avoid CORS issues and simplify the setup.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
