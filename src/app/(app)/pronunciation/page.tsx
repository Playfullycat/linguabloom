import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "Pronunciation" };

export default function PronunciationPage() {
  return <PlannedFeaturePage featureKey="pronunciation" eyebrow="Learn · 学习" />;
}
