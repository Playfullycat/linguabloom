import { rawCatalog, rawUnitFiles } from "../../../content";

import { catalogSchema, unitFileSchema, type Catalog, type UnitFile } from "./schema";

export type LoadedContent = {
  catalog: Catalog;
  /** Fully authored units keyed by unit id. */
  units: Map<string, UnitFile>;
};

/**
 * Parse and cross-check all course content. Throws one readable error listing
 * every problem (file, path, message) so authors can fix them in one pass.
 */
export function loadContent(): LoadedContent {
  const problems: string[] = [];

  const catalogResult = catalogSchema.safeParse(rawCatalog);
  if (!catalogResult.success) {
    for (const issue of catalogResult.error.issues) problems.push(`catalog.json ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid course content:\n  ${problems.join("\n  ")}`);
  }
  const catalog = catalogResult.data;

  const ids = catalog.units.map((u) => u.id);
  if (new Set(ids).size !== ids.length) problems.push("catalog.json: duplicate unit ids");
  const orderKeys = catalog.units.map((u) => `${u.level}:${u.order}`);
  if (new Set(orderKeys).size !== orderKeys.length) problems.push("catalog.json: duplicate (level, order) pairs");

  const units = new Map<string, UnitFile>();
  const referenced = new Set<string>();

  for (const entry of catalog.units) {
    if (!entry.file) continue;
    referenced.add(entry.file);
    const raw = rawUnitFiles[entry.file];
    if (raw === undefined) {
      problems.push(`catalog.json: ${entry.id} points to "${entry.file}", which is not registered in src/content/index.ts`);
      continue;
    }
    const result = unitFileSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) problems.push(`${entry.file} ${issue.path.join(".")}: ${issue.message}`);
      continue;
    }
    const unit = result.data.unit;
    if (unit.id !== entry.id || unit.level !== entry.level || unit.order !== entry.order) {
      problems.push(`${entry.file}: id/level/order must match its catalog entry (${entry.id}, ${entry.level}, ${entry.order})`);
    }
    units.set(unit.id, result.data);
  }

  for (const file of Object.keys(rawUnitFiles)) {
    if (!referenced.has(file)) problems.push(`src/content/index.ts: "${file}" is registered but not referenced by catalog.json`);
  }

  if (problems.length > 0) throw new Error(`Invalid course content:\n  ${problems.join("\n  ")}`);
  return { catalog, units };
}
