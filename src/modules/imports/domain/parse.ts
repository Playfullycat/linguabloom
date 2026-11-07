/**
 * Parsers for imported material (spec §5.14). Pure functions: no AI, no
 * network. Every problem is reported as a warning the learner sees in the
 * preview, never silently dropped.
 */

export const IMPORT_LIMITS = {
  textChars: 20_000,
  segments: 400,
  wordRows: 500,
  audioBytes: 50 * 1024 * 1024,
  fileBytes: 2 * 1024 * 1024,
} as const;

export type ParsedSegment = { en: string; zh: string | null; startMs: number | null; endMs: number | null; speaker: string | null; paragraph: number };
export type ParsedWord = { line: number; text: string; zh: string; ipa: string | null; pos: string | null; exampleEn: string | null; exampleZh: string | null };
export type ParseResult<T> = { items: T[]; warnings: string[] };

// ------------------------------------------------------------ sentences ----

const ABBREVIATIONS = ["mr", "mrs", "ms", "dr", "prof", "st", "vs", "etc", "e.g", "i.e", "a.m", "p.m", "no", "jr", "sr", "u.s", "u.k"];

/** Split a paragraph into sentences, keeping abbreviations like "Mr." and "e.g." intact. */
export function splitSentences(paragraph: string): string[] {
  const text = paragraph.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const out: string[] = [];
  let start = 0;
  const re = /([.!?…]+)(["'”’)\]]*)\s+(?=["'“‘(\[]?[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[1]!.length + m[2]!.length;
    const before = text.slice(start, m.index + m[1]!.length);
    const lastWord = before.split(/\s+/).pop()!.toLowerCase().replace(/[.!?…]+$/, "");
    if (m[1] === "." && (ABBREVIATIONS.includes(lastWord) || /^[a-z]$/i.test(lastWord))) continue;
    out.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Remove Markdown syntax but keep the words. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Line-start patterns use [ \t] (not \s) so blank lines between paragraphs survive.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
    .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/<[^>]+>/g, "");
}

const cjkShare = (s: string) => {
  const letters = s.replace(/\s/g, "");
  if (!letters) return 0;
  return (letters.match(/[㐀-鿿]/g)?.length ?? 0) / letters.length;
};

/** Plain text or Markdown → sentences grouped by paragraph. */
export function parseText(raw: string, kind: "paste" | "txt" | "markdown"): ParseResult<ParsedSegment> {
  const warnings: string[] = [];
  let text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (text.length > IMPORT_LIMITS.textChars) {
    warnings.push(`文本超过 ${IMPORT_LIMITS.textChars} 个字符，只导入了前面的部分。`);
    text = text.slice(0, IMPORT_LIMITS.textChars);
  }
  // Pasted text is often Markdown (notes apps): clean it up when it clearly is.
  const looksLikeMarkdown = /^[ \t]{0,3}#{1,6}[ \t]|^[ \t]*[-*+][ \t]|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/m.test(text);
  if (kind === "markdown" || (kind === "paste" && looksLikeMarkdown)) text = stripMarkdown(text);
  if (cjkShare(text) > 0.2) warnings.push("这段内容里中文比较多。目前只支持英文材料，中文部分会原样保留。");
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const items: ParsedSegment[] = [];
  paragraphs.forEach((p, paragraph) => {
    for (const en of splitSentences(p)) items.push({ en, zh: null, startMs: null, endMs: null, speaker: null, paragraph });
  });
  if (items.length > IMPORT_LIMITS.segments) {
    warnings.push(`超过 ${IMPORT_LIMITS.segments} 句，只导入了前 ${IMPORT_LIMITS.segments} 句。`);
    items.length = IMPORT_LIMITS.segments;
  }
  if (items.length === 0) warnings.push("没有找到可以导入的句子。");
  return { items, warnings };
}

// ------------------------------------------------------------ subtitles ----

function timeToMs(t: string): number | null {
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return ((Number(h ?? 0) * 60 + Number(min)) * 60 + Number(s)) * 1000 + Number(ms!.padEnd(3, "0"));
}

/**
 * SRT or WebVTT → timed cues. Real timestamps only: cues that can't be read
 * are skipped with a warning (never guessed).
 */
export function parseSubtitles(raw: string, kind: "srt" | "vtt"): ParseResult<ParsedSegment> {
  const warnings: string[] = [];
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (kind === "vtt" && !text.trimStart().startsWith("WEBVTT")) warnings.push("文件开头没有 WEBVTT 标记，按字幕格式尝试读取。");
  const blocks = text.split(/\n\s*\n/);
  const items: ParsedSegment[] = [];
  let skipped = 0;
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx === -1) continue; // header, NOTE, STYLE, numbering-only
    const [a, b] = lines[timeIdx]!.split("-->");
    const startMs = timeToMs(a!);
    const endMs = timeToMs(b!.trim().split(/\s+/)[0]!);
    const body = lines.slice(timeIdx + 1).join(" ");
    if (startMs === null || endMs === null || endMs <= startMs) {
      skipped += 1;
      continue;
    }
    let speaker: string | null = null;
    const voice = body.match(/<v(?:\.[^ >]+)?\s+([^>]+)>/);
    if (voice) speaker = voice[1]!.trim();
    const clean = body
      .replace(/<[^>]+>/g, "")
      .replace(/\{\\[^}]*\}/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) continue;
    items.push({ en: clean, zh: null, startMs, endMs, speaker, paragraph: 0 });
  }
  if (skipped > 0) warnings.push(`${skipped} 条字幕的时间格式读不出来，已跳过。`);
  items.sort((x, y) => x.startMs! - y.startMs!);
  if (items.length > IMPORT_LIMITS.segments) {
    warnings.push(`超过 ${IMPORT_LIMITS.segments} 条字幕，只导入了前 ${IMPORT_LIMITS.segments} 条。`);
    items.length = IMPORT_LIMITS.segments;
  }
  if (items.length === 0) warnings.push("没有找到带时间的字幕。");
  return { items, warnings };
}

// ------------------------------------------------------------ word list ----

/** RFC 4180-style parsing (quoted fields, doubled quotes, separators inside quotes). */
export function parseDelimited(raw: string, sep: "," | "\t"): string[][] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ""));
}

const HEADER_ALIASES: Record<keyof Omit<ParsedWord, "line">, string[]> = {
  text: ["word", "text", "term", "english", "en", "单词", "词", "英文"],
  zh: ["meaning", "definition", "chinese", "zh", "translation", "释义", "中文", "意思"],
  ipa: ["ipa", "phonetic", "pronunciation", "音标"],
  pos: ["pos", "part of speech", "词性"],
  exampleEn: ["example", "example_en", "sentence", "例句"],
  exampleZh: ["example_zh", "example translation", "例句翻译", "例句中文"],
};

/**
 * CSV / TSV word list. With a header row, columns are matched by name;
 * without one, the first column is the word and the second its meaning.
 */
export function parseWordList(raw: string, kind: "csv" | "tsv"): ParseResult<ParsedWord> {
  const warnings: string[] = [];
  const rows = parseDelimited(raw, kind === "tsv" ? "\t" : ",");
  if (rows.length === 0) return { items: [], warnings: ["文件是空的。"] };
  const header = rows[0]!.map((h) => h.toLowerCase());
  const col: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [keyof typeof HEADER_ALIASES, string[]][]) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx !== -1) col[key] = idx;
  }
  const hasHeader = col.text !== undefined;
  if (!hasHeader) {
    col.text = 0;
    col.zh = 1;
    if (rows[0]!.length >= 3) col.exampleEn = 2;
    warnings.push("没有识别到表头，按“第一列单词、第二列释义、第三列例句”读取。");
  }
  const items: ParsedWord[] = [];
  const seen = new Set<string>();
  const get = (r: string[], k: keyof typeof HEADER_ALIASES) => (col[k] !== undefined ? (r[col[k]!] ?? "").trim() || null : null);
  rows.slice(hasHeader ? 1 : 0).forEach((r, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const text = get(r, "text");
    const zh = get(r, "zh");
    if (!text) return;
    if (!zh) {
      warnings.push(`第 ${line} 行“${text}”缺少释义，已跳过。`);
      return;
    }
    if (text.length > 80) {
      warnings.push(`第 ${line} 行太长，已跳过。`);
      return;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`第 ${line} 行“${text}”在文件里重复了，只保留第一次。`);
      return;
    }
    seen.add(key);
    items.push({ line, text, zh: zh.slice(0, 200), ipa: get(r, "ipa"), pos: get(r, "pos"), exampleEn: get(r, "exampleEn"), exampleZh: get(r, "exampleZh") });
  });
  if (items.length > IMPORT_LIMITS.wordRows) {
    warnings.push(`超过 ${IMPORT_LIMITS.wordRows} 个词，只导入了前 ${IMPORT_LIMITS.wordRows} 个。`);
    items.length = IMPORT_LIMITS.wordRows;
  }
  if (items.length === 0) warnings.push("没有找到可以导入的词。");
  return { items, warnings };
}

// ------------------------------------------------------------- analysis ----

export type TextAnalysis = {
  wordCount: number;
  sentenceCount: number;
  uniqueWords: number;
  averageSentenceLength: number;
  longestSentence: number;
  longSentences: number;
  /** Share of running words the learner has already studied (vocabulary lab + taught words). */
  knownShare: number | null;
  suggestedLevel: "a1" | "a2" | "b1" | "b2" | "c1";
};

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

/**
 * Rough, explainable difficulty numbers (no AI). The level suggestion is
 * based on average sentence length only, and the learner can change it.
 */
export function analyzeText(sentences: string[], known: Set<string> | null): TextAnalysis {
  const lengths = sentences.map((s) => (s.match(WORD) ?? []).length);
  const tokens = sentences.flatMap((s) => (s.match(WORD) ?? []).map((w) => w.toLowerCase().replace(/’/g, "'")));
  const wordCount = tokens.length;
  const avg = sentences.length ? wordCount / sentences.length : 0;
  const suggestedLevel = avg <= 8 ? "a1" : avg <= 12 ? "a2" : avg <= 16 ? "b1" : avg <= 21 ? "b2" : "c1";
  return {
    wordCount,
    sentenceCount: sentences.length,
    uniqueWords: new Set(tokens).size,
    averageSentenceLength: Math.round(avg * 10) / 10,
    longestSentence: Math.max(0, ...lengths),
    longSentences: lengths.filter((l) => l > 20).length,
    knownShare: known && wordCount > 0 ? Math.round((tokens.filter((t) => known.has(t)).length / wordCount) * 1000) / 1000 : null,
    suggestedLevel,
  };
}
