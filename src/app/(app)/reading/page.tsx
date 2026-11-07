import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "Reading" };

export default function ReadingPage() {
  return <PlannedFeaturePage featureKey="reading" eyebrow="Learn · 学习" />;
}
