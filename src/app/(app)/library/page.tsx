import type { Metadata } from "next";

import { PlannedFeaturePage } from "@/components/layout/planned-feature";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return <PlannedFeaturePage featureKey="library" />;
}
