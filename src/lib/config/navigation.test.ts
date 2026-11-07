import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getFeature,
  isNavEntryActive,
  isNavGroup,
  learnGroup,
  mobileNav,
  practiceGroup,
  primaryNav,
  secondaryNav,
  type Feature,
} from "./navigation";

const allLeaves: Feature[] = [
  ...primaryNav.flatMap((entry) => (isNavGroup(entry) ? entry.children : [entry])),
  ...secondaryNav,
];

describe("navigation config", () => {
  it("has unique keys and hrefs", () => {
    const keys = allLeaves.map((f) => f.key);
    const hrefs = allLeaves.map((f) => f.href);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("has a real page for every nav link (no dead links)", () => {
    const appDir = path.resolve(import.meta.dirname, "../../app/(app)");
    const hrefs = [
      ...allLeaves.map((f) => f.href),
      ...primaryNav.filter(isNavGroup).map((g) => g.href),
    ];
    for (const href of hrefs) {
      expect(existsSync(path.join(appDir, href, "page.tsx")), `missing page for ${href}`).toBe(true);
    }
  });

  it("keeps the mobile bar at 4–5 items (spec §6.5)", () => {
    expect(mobileNav.length).toBeGreaterThanOrEqual(4);
    expect(mobileNav.length).toBeLessThanOrEqual(5);
  });

  it("lists highlights for every not-yet-available feature", () => {
    for (const feature of allLeaves.filter((f) => f.key !== "settings")) {
      expect(feature.highlights.length, feature.key).toBeGreaterThan(0);
    }
  });

  it("throws on unknown feature keys", () => {
    expect(() => getFeature("nope")).toThrow(/Unknown feature key/);
  });
});

describe("isNavEntryActive", () => {
  it("matches a leaf and its nested routes only", () => {
    const today = getFeature("today");
    expect(isNavEntryActive(today, "/today")).toBe(true);
    expect(isNavEntryActive(today, "/today/anything")).toBe(true);
    expect(isNavEntryActive(today, "/todayish")).toBe(false);
  });

  it("marks a group active on its hub and on any child route", () => {
    expect(isNavEntryActive(learnGroup, "/learn")).toBe(true);
    expect(isNavEntryActive(learnGroup, "/learn/path")).toBe(true);
    expect(isNavEntryActive(learnGroup, "/vocabulary")).toBe(true);
    expect(isNavEntryActive(learnGroup, "/review")).toBe(false);
    expect(isNavEntryActive(practiceGroup, "/pte")).toBe(true);
  });
});
