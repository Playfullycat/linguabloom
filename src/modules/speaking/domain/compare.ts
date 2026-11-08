/**
 * Read-aloud / repeat check: which words of the reference were heard in the
 * transcript (word-level LCS, case and punctuation ignored). This measures
 * what the transcriber recognised, not pronunciation quality — the UI says so.
 */

export type ComparedWord = { text: string; heard: boolean };
export type Comparison = { words: ComparedWord[]; heard: number; total: number; score: number; extra: string[] };

const norm = (w: string) =>
  w
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");

/** Display tokens of the reference keep their punctuation; matching uses the normalised form. */
export function compareReading(reference: string, transcript: string): Comparison {
  const refTokens = reference.split(/\s+/).filter(Boolean);
  const ref = refTokens.map(norm);
  const heardWords = transcript.split(/\s+/).map(norm).filter(Boolean);
  const n = ref.length;
  const m = heardWords.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1)
    for (let j = m - 1; j >= 0; j -= 1) dp[i]![j] = ref[i] !== "" && ref[i] === heardWords[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);

  const matched = new Set<number>();
  const usedHeard = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ref[i] !== "" && ref[i] === heardWords[j]) {
      matched.add(i);
      usedHeard.add(j);
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i += 1;
    else j += 1;
  }
  const words = refTokens.map((text, k) => ({ text, heard: matched.has(k) || ref[k] === "" }));
  const total = ref.filter((w) => w !== "").length;
  const heard = matched.size;
  return {
    words,
    heard,
    total,
    score: total === 0 ? 0 : Math.round((heard / total) * 100) / 100,
    extra: heardWords.filter((_, k) => !usedHeard.has(k)).slice(0, 10),
  };
}
