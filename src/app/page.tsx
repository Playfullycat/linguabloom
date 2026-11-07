import { redirect } from "next/navigation";

// Phase 0.2 adds the setup/login decision here; until then the app opens on Today.
export default function Home() {
  redirect("/today");
}
