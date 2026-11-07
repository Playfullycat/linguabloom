import { Check, Hammer } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getFeature, type Feature } from "@/lib/config/navigation";

export function PhaseBadge({ phase }: { phase: Feature["phase"] }) {
  return (
    <Badge tone="yellow">
      <Hammer aria-hidden="true" />
      Phase {phase} 上线
    </Badge>
  );
}

/**
 * Honest placeholder for a feature that is not built yet: says what it will
 * do and when, with no fake data and no dead controls.
 */
export function PlannedFeaturePage({ featureKey, eyebrow }: { featureKey: string; eyebrow?: string }) {
  const feature = getFeature(featureKey);
  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={feature.label}
        titleZh={feature.labelZh}
        description={feature.summary}
        actions={<PhaseBadge phase={feature.phase} />}
      />
      <EmptyState
        icon={feature.icon}
        title={`${feature.labelZh}还在建设中`}
        description={`按实施计划，这部分在 Phase ${feature.phase} 完成。上线后你可以在这里：`}
      >
        <ul className="mt-1 flex max-w-md flex-col gap-2 text-left text-sm text-ink">
          {feature.highlights.map((item) => (
            <li key={item} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-mint-ink" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </EmptyState>
    </>
  );
}
