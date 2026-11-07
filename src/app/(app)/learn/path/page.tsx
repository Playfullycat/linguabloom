import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "Learning Path" };

export default function LearningPathPage() {
  return <PlannedFeaturePage featureKey="path" eyebrow="Learn · 学习" />;
}
