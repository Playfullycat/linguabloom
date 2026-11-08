import type { BadgeTone } from "@/components/ui/badge";

/** Status shown for an error item (derived from status + occurrence count). */
export function errorStatus(item: { status: string; needsRemediation: boolean; retestDue: boolean }): { label: string; tone: BadgeTone } {
  if (item.status === "resolved") return { label: "已解决", tone: "mint" };
  if (item.status === "retest") return item.retestDue ? { label: "可以再测", tone: "yellow" } : { label: "等待再测", tone: "blue" };
  if (item.needsRemediation) return { label: "需要补救", tone: "coral" };
  return { label: "已记录", tone: "neutral" };
}

export const SOURCE_LABELS: Record<string, string> = {
  lesson: "课程",
  review: "复习",
  grammar: "语法练习",
  reading: "阅读",
  listening: "听力",
  writing: "写作",
  speaking: "口语",
};
