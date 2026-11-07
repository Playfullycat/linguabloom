import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "Vocabulary" };

export default function VocabularyPage() {
  return <PlannedFeaturePage featureKey="vocabulary" eyebrow="Learn · 学习" />;
}
