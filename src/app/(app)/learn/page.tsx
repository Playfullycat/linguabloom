import type { Metadata } from "next";

import { FeatureHub } from "@/components/layout/feature-hub";
import { learnGroup } from "@/lib/config/navigation";

export const metadata: Metadata = { title: "Learn" };

export default function LearnPage() {
  return <FeatureHub group={learnGroup} />;
}
