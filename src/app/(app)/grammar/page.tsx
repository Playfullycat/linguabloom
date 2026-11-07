import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "Grammar" };

export default function GrammarPage() {
  return <PlannedFeaturePage featureKey="grammar" eyebrow="Learn · 学习" />;
}
