import type { NextConfig } from "next";

/**
 * Baseline security headers (spec §11.1). A Content-Security-Policy is not
 * set yet: the pre-paint theme script is inline and needs a nonce/hash setup.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone stays available to this origin for speaking practice (Phase 3).
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Default bottom-left covers the sidebar footer controls; top-left only overlaps the logo link.
  devIndicators: { position: "top-left" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
