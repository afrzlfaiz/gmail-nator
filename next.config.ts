import type { NextConfig } from "next";

const configuredBackendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;
const backendUrl = (configuredBackendUrl || (process.env.NODE_ENV === "production" ? "" : "http://localhost:4000")).replace(/\/$/, "");

const nextConfig: NextConfig = backendUrl
  ? {
      async rewrites() {
        return [
          {
            source: "/api/:path*",
            destination: `${backendUrl}/api/:path*`,
          },
        ];
      },
    }
  : {};

export default nextConfig;
