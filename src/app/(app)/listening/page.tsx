import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "Listening" };

export default function ListeningPage() {
  return <PlannedFeaturePage featureKey="listening" eyebrow="Learn · 学习" />;
}
