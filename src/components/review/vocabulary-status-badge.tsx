import { Badge, type BadgeTone } from "@/components/ui/badge";
import { STATUS_LABELS, type VocabularyStatusValue } from "@/modules/review/domain/status";

const tones: Record<VocabularyStatusValue, BadgeTone> = {
  new: "neutral",
  learning: "blue",
  receptive_known: "primary",
  productive_developing: "yellow",
  productive_known: "mint",
  difficult: "coral",
  suspended: "outline",
};

export function VocabularyStatusBadge({ status }: { status: string }) {
  const key = (status in STATUS_LABELS ? status : "new") as VocabularyStatusValue;
  return (
    <Badge tone={tones[key]} size="sm">
      {STATUS_LABELS[key]}
    </Badge>
  );
}
