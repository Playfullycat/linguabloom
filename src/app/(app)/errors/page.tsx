import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "Error Notebook" };

export default function ErrorNotebookPage() {
  return <PlannedFeaturePage featureKey="errors" eyebrow="Practice · 练习" />;
}
