// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/auth/constants";

import { proxy } from "./proxy";

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("proxy (optimistic auth gate)", () => {
  it("redirects protected pages to /login when there is no session cookie", () => {
    const res = proxy(request("/today"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("lets requests with a session cookie through (pages still verify it)", () => {
    expect(proxy(request("/today", "lb.session_token=abc.def")).headers.get("location")).toBeNull();
    expect(proxy(request("/today", "__Secure-lb.session_token=abc.def")).headers.get("location")).toBeNull();
  });

  it("ignores cookies from other apps", () => {
    expect(proxy(request("/settings", "better-auth.session_token=abc")).status).toBe(307);
  });

  it("never blocks the entry page or public pages", () => {
    for (const path of ["/", "/login", "/setup"]) {
      expect(proxy(request(path)).headers.get("location"), path).toBeNull();
    }
  });
});

describe("isPublicPath", () => {
  it("matches only the public routes and their children", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/setup")).toBe(true);
    expect(isPublicPath("/login-help")).toBe(false);
    expect(isPublicPath("/today")).toBe(false);
  });
});
