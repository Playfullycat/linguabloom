import { SearchX } from "lucide-react";
import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-mark";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-16">
      <div className="flex w-full max-w-lg flex-col items-center gap-6">
        <BrandMark className="size-10" />
        <EmptyState
          icon={SearchX}
          title="没有找到这个页面"
          description="链接可能已经变化。回到今日页面继续学习吧。"
          action={
            <Button asChild>
              <Link href="/today">回到 Today</Link>
            </Button>
          }
          className="w-full bg-surface"
        />
      </div>
    </main>
  );
}
