// @vitest-environment node
import { describe, expect, it } from "vitest";

import { analyzeText, parseDelimited, parseSubtitles, parseText, parseWordList, splitSentences, stripMarkdown } from "./parse";

describe("text import", () => {
  it("splits sentences without breaking abbreviations or initials", () => {
    expect(splitSentences("Mr. Smith lives in the U.K. now. He likes tea! Does he? Yes.")).toEqual(["Mr. Smith lives in the U.K. now.", "He likes tea!", "Does he?", "Yes."]);
    expect(splitSentences('She said, "Hi." Then she left.')).toEqual(['She said, "Hi."', "Then she left."]);
    expect(splitSentences("We met at 9 a.m. Today it rained.")).toEqual(["We met at 9 a.m. Today it rained."]);
  });

  it("strips Markdown and keeps paragraphs", () => {
    expect(stripMarkdown("# Title\n\n**Bold** and [a link](http://x) and `code`.")).toBe("Title\n\nBold and a link and code.");
    const r = parseText("# My Day\n\nI get up early. I drink tea.\n\n- Then I walk to work.", "markdown");
    expect(r.items.map((s) => [s.paragraph, s.en])).toEqual([
      [0, "My Day"],
      [1, "I get up early."],
      [1, "I drink tea."],
      [2, "Then I walk to work."],
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("cleans up pasted Markdown but leaves plain pasted text alone", () => {
    expect(parseText("# Morning\n\nHello! I walk to work.", "paste").items.map((s) => s.en)).toEqual(["Morning", "Hello!", "I walk to work."]);
    expect(parseText("It costs 5 * 3 = 15 dollars.", "paste").items[0]!.en).toBe("It costs 5 * 3 = 15 dollars.");
  });

  it("warns instead of silently dropping", () => {
    expect(parseText("", "paste").warnings).toContain("没有找到可以导入的句子。");
    expect(parseText("这是一段中文文本，不是英文。", "paste").warnings[0]).toMatch(/中文比较多/);
    expect(parseText("a".repeat(25_000), "txt").warnings[0]).toMatch(/只导入了前面的部分/);
  });
});

describe("subtitle import", () => {
  it("reads SRT with real timestamps", () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:02,500\r\nHello, Anna.\r\n\r\n2\r\n00:00:03,000 --> 00:00:05,250\r\n<i>How are</i>\r\nyou today?\r\n";
    const r = parseSubtitles(srt, "srt");
    expect(r.items).toEqual([
      { en: "Hello, Anna.", zh: null, startMs: 1000, endMs: 2500, speaker: null, paragraph: 0 },
      { en: "How are you today?", zh: null, startMs: 3000, endMs: 5250, speaker: null, paragraph: 0 },
    ]);
  });

  it("reads WebVTT voices and skips cues with broken times", () => {
    const vtt = "WEBVTT\n\nNOTE a comment\n\n00:01.000 --> 00:02.000 align:start\n<v Leo>Hi there!</v>\n\n00:05.000 --> 00:03.000\nBackwards\n\n00:00:06.000 --> 00:00:07.500\nBye &amp; thanks.";
    const r = parseSubtitles(vtt, "vtt");
    expect(r.items.map((i) => [i.speaker, i.en, i.startMs, i.endMs])).toEqual([
      ["Leo", "Hi there!", 1000, 2000],
      [null, "Bye & thanks.", 6000, 7500],
    ]);
    expect(r.warnings[0]).toMatch(/1 条字幕/);
  });
});

describe("word list import", () => {
  it("parses quoted CSV fields", () => {
    expect(parseDelimited('word,meaning\n"look up","查（词典）, 查找"\n"say ""hi""",打招呼', ",")).toEqual([
      ["word", "meaning"],
      ["look up", "查（词典）, 查找"],
      ['say "hi"', "打招呼"],
    ]);
  });

  it("matches columns by header, skips incomplete and duplicate rows", () => {
    const r = parseWordList("Word,IPA,Meaning,Example\nborrow,/ˈbɒrəʊ/,借,Can I borrow it?\nlend,,,\nBorrow,,借入,\nreturn,,归还,", "csv");
    expect(r.items.map((i) => [i.line, i.text, i.zh, i.ipa, i.exampleEn])).toEqual([
      [2, "borrow", "借", "/ˈbɒrəʊ/", "Can I borrow it?"],
      [5, "return", "归还", null, null],
    ]);
    expect(r.warnings).toEqual(["第 3 行“lend”缺少释义，已跳过。", "第 4 行“Borrow”在文件里重复了，只保留第一次。"]);
  });

  it("reads a TSV without a header as word / meaning / example", () => {
    const r = parseWordList("apple\t苹果\tI eat an apple.\nbanana\t香蕉", "tsv");
    expect(r.items.map((i) => [i.text, i.zh, i.exampleEn])).toEqual([
      ["apple", "苹果", "I eat an apple."],
      ["banana", "香蕉", null],
    ]);
    expect(r.warnings[0]).toMatch(/没有识别到表头/);
  });
});

describe("analysis", () => {
  it("reports explainable numbers and a rough level", () => {
    const a = analyzeText(["I like tea.", "She likes coffee very much."], new Set(["i", "like", "tea"]));
    expect(a).toMatchObject({ wordCount: 8, sentenceCount: 2, uniqueWords: 8, averageSentenceLength: 4, longestSentence: 5, suggestedLevel: "a1", knownShare: 0.375 });
    expect(analyzeText([Array.from({ length: 18 }, () => "word").join(" ") + "."], null)).toMatchObject({ suggestedLevel: "b2", knownShare: null });
  });
});
