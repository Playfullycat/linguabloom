import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "AI Tutor" };

export default function TutorPage() {
  return <PlannedFeaturePage featureKey="tutor" />;
}
