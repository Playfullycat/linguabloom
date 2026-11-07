import { CheckCircle2, CircleDashed, PlayCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { LessonProgressStatus } from "@/modules/curriculum/services/queries";

/** Status with icon + text (never colour alone). */
export function LessonStatusBadge({ status }: { status: LessonProgressStatus }) {
  if (status === "completed") {
    return (
      <Badge tone="mint" size="sm">
        <CheckCircle2 aria-hidden="true" />
        已完成
      </Badge>
    );
  }
  if (status === "in_progress") {
    return (
      <Badge tone="blue" size="sm">
        <PlayCircle aria-hidden="true" />
        学习中
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" size="sm">
      <CircleDashed aria-hidden="true" />
      未开始
    </Badge>
  );
}
