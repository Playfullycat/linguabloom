/**
 * Run the production build the same way the Docker image does:
 * copy static assets next to the standalone server, then start it.
 *   npm run build && npm start        (PORT / HOSTNAME env are respected)
 * Works on Windows and Unix (no shell `cp` needed).
 */
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const standalone = path.resolve(".next/standalone");
const server = path.join(standalone, "server.js");

if (!existsSync(server)) {
  console.error("No standalone build found. Run `npm run build` first.");
  process.exit(1);
}

cpSync(".next/static", path.join(standalone, ".next/static"), { recursive: true });
if (existsSync("public")) cpSync("public", path.join(standalone, "public"), { recursive: true });

await import(pathToFileURL(server).href);
