import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content-Security-Policy without nonces (Next.js CSP guide, "Without Nonces").
 * Nonce-based CSP forces every page to render dynamically and is incompatible
 * with Partial Prerendering, which this app relies on. Inline scripts are
 * therefore allowed ('unsafe-inline': Next.js bootstrap + the pre-paint theme
 * script), while external scripts, plugins, framing, foreign form targets and
 * <base> hijacking are blocked.
 *
 * Phase 3 (voice) will extend connect-src/media-src for the AI provider.
 * `upgrade-insecure-requests` is left to the HTTPS reverse proxy, because this
 * header is fixed at build time and plain-HTTP LAN installs must keep working.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Baseline security headers (spec §11.1). */
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone stays available to this origin for speaking practice (Phase 3).
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (.next/standalone/server.js).
  output: "standalone",
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
