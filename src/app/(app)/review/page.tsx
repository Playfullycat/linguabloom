import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "Review" };

export default function ReviewPage() {
  return <PlannedFeaturePage featureKey="review" eyebrow="Practice · 练习" />;
}
