import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "Speaking" };

export default function SpeakingPage() {
  return <PlannedFeaturePage featureKey="speaking" eyebrow="Practice · 练习" />;
}
