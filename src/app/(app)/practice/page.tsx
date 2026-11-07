import type { Metadata } from "next";

import { FeatureHub } from "@/components/layout/feature-hub";
import { practiceGroup } from "@/lib/config/navigation";

export const metadata: Metadata = { title: "Practice" };

export default function PracticePage() {
  return <FeatureHub group={practiceGroup} />;
}
