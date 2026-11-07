import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "PTE" };

export default function PtePage() {
  return <PlannedFeaturePage featureKey="pte" eyebrow="Practice · 练习" />;
}
