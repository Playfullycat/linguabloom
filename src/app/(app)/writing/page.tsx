import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "Writing" };

export default function WritingPage() {
  return <PlannedFeaturePage featureKey="writing" eyebrow="Practice · 练习" />;
}
