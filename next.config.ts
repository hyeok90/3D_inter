import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // This makes the Vercel deployment URL available to the client-side code.
    NEXT_PUBLIC_API_BASE_URL: process.env.VERCEL_URL
      ? `https://` + process.env.VERCEL_URL
      : "http://localhost:8000",
  },
};

export default nextConfig;
