/**
 * Registry of course content files.
 *
 * Files are imported statically so they are bundled into the seed CLI used
 * by the Docker image. To add a fully authored unit:
 *   1. add the JSON file under src/content/<level>/
 *   2. register it below with the same path used in catalog.json "file"
 *   3. run `npm run test` (validates every file) and `npm run db:seed`
 */
import a1PronounsBe from "./a1/u01-pronouns-be.json" with { type: "json" };
import a1WordOrder from "./a1/u02-word-order.json" with { type: "json" };
import a1Questions from "./a1/u03-questions.json" with { type: "json" };
import catalog from "./catalog.json" with { type: "json" };
import preA1Hello from "./pre-a1/u03-hello.json" with { type: "json" };
import preA1MyNameIs from "./pre-a1/u04-my-name-is.json" with { type: "json" };
import preA1Numbers from "./pre-a1/u05-numbers.json" with { type: "json" };

export const rawCatalog: unknown = catalog;

export const rawUnitFiles: Record<string, unknown> = {
  "pre-a1/u03-hello.json": preA1Hello,
  "pre-a1/u04-my-name-is.json": preA1MyNameIs,
  "pre-a1/u05-numbers.json": preA1Numbers,
  "a1/u01-pronouns-be.json": a1PronounsBe,
  "a1/u02-word-order.json": a1WordOrder,
  "a1/u03-questions.json": a1Questions,
};
