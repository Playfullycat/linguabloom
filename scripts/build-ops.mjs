/**
 * Bundle the database CLIs into self-contained ESM files for the production
 * image (no node_modules, no tsx needed at runtime):
 *   dist/ops/db-migrate.mjs   dist/ops/db-seed.mjs   dist/ops/reset-owner-password.mjs
 * Usage: npm run build:ops
 */
import { rm } from "node:fs/promises";

import { build } from "esbuild";

await rm("dist/ops", { recursive: true, force: true });

await build({
  entryPoints: {
    "db-migrate": "scripts/db-migrate.ts",
    "db-seed": "scripts/db-seed.ts",
    "reset-owner-password": "scripts/reset-owner-password.ts",
  },
  outdir: "dist/ops",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
  // Native module: resolved at runtime from node_modules (the standalone
  // output in the image ships it because the app uses it).
  external: ["@node-rs/argon2"],
  // Some bundled CJS dependencies call require(); give ESM output a working one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
