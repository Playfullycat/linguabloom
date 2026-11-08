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
import a2PastStories from "./a2/u01-past-stories.json" with { type: "json" };
import a2Future from "./a2/u03-future.json" with { type: "json" };
import b1Conditionals from "./b1/u02-conditionals.json" with { type: "json" };
import b1Opinions from "./b1/u06-opinions.json" with { type: "json" };
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
  "a2/u01-past-stories.json": a2PastStories,
  "a2/u03-future.json": a2Future,
  "b1/u02-conditionals.json": b1Conditionals,
  "b1/u06-opinions.json": b1Opinions,
};
