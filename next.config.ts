import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security/csp";

const nextConfig: NextConfig = {
  // Cache Components stays OFF: every financial page renders per request and nothing
  // user-specific enters a shared server cache (ARCHITECTURE.md §7).
  poweredByHeader: false,
  // Keep the dev-only indicator clear of the mobile bottom navigation.
  devIndicators: { position: "top-right" },
  reactStrictMode: true,
  experimental: {
    // CSV imports are posted to a server action (files are capped at 1 MB in code).
    serverActions: { bodySizeLimit: "2mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }];
  },
};

export default nextConfig;
