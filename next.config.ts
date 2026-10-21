import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // FORCES NEXT.JS TO BYPASS MISSING SERVER VARIABLES OR API ROUTE ERRORS DURING STATIC EXPORT
  experimental: {
    missingSuspenseWithCSRBypass: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
