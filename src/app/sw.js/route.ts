import { readFile } from "node:fs/promises";
import path from "node:path";

import { connection } from "next/server";

/**
 * Service worker (Next.js PWA guide), served from a route so it carries the
 * build id: every deploy installs a fresh worker and drops the old caches.
 *
 * What it caches, and nothing else:
 * - the static offline shell (/offline) and the scripts/styles it needs;
 * - other immutable build assets (/_next/static/…) as they are requested.
 * Pages with personal data are never stored. A page that can't load while
 * offline falls back to /offline, where due reviews can still be done
 * (their data lives in the browser, see src/lib/offline/store.ts).
 */
async function buildId(): Promise<string> {
  try {
    return (await readFile(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim();
  } catch {
    return "dev";
  }
}

const script = (version: string) => `// LinguaBloom service worker — build ${version}
const VERSION = ${JSON.stringify(version)};
const SHELL = "lb-shell-" + VERSION;
const STATIC = "lb-static-" + VERSION;
const OFFLINE_URL = "/offline";

async function cacheShell() {
  const cache = await caches.open(SHELL);
  const response = await fetch(OFFLINE_URL, { cache: "no-store", credentials: "omit" });
  if (!response.ok) return;
  const html = await response.clone().text();
  await cache.put(OFFLINE_URL, response);
  const assets = [...new Set([...html.matchAll(/\\/_next\\/static\\/[^"'\\s)\\\\]+/g)].map((m) => m[0]))];
  await Promise.allSettled([...assets, "/manifest.webmanifest", "/icons/192"].map((url) => cache.add(url)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("lb-") && k !== SHELL && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "refresh-shell") event.waitUntil(cacheShell());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Immutable build assets: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Page loads: always the network; the offline shell only when the network fails.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) || new Response("离线中，且还没有缓存离线页面。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })),
    );
  }
});
`;

export async function GET() {
  await connection();
  return new Response(script(await buildId()), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'",
      "Service-Worker-Allowed": "/",
    },
  });
}
