import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "Progress" };

export default function ProgressPage() {
  return <PlannedFeaturePage featureKey="progress" />;
}
