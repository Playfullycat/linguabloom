import { CalendarCheck, ChartLine, Map, RotateCcw } from "lucide-react";
import type { Metadata } from "next";

import { SessionTemplatePicker } from "@/components/learning/session-template-picker";
import { PageHeader, SectionHeader } from "@/components/layout/page-header";
import { PhaseBadge } from "@/components/layout/planned-feature";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Today" };

const upcoming = [
  {
    icon: RotateCcw,
    title: "到期复习",
    description: "复习系统上线后，这里显示今天到期的卡片数量和预计用时。",
  },
  {
    icon: Map,
    title: "当前课程",
    description: "完成水平诊断后，会从适合你的单元开始，并显示下一步。",
  },
  {
    icon: ChartLine,
    title: "本周投入",
    description: "开始学习后，按输入、输出、刻意练习和流利度记录每周时间。",
  },
];

export default function TodayPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <CalendarCheck className="size-4" aria-hidden="true" />
            <span lang="en">Today</span> · 今日
          </span>
        }
        title="Welcome to LinguaBloom"
        description="课程给方向，输入积累语感，刻意练习补短板，输出检验会不会用，间隔复习帮你记得更久。"
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>今天想学多久？</CardTitle>
            <CardDescription>
              先看看不同时长的学习由哪些部分组成。完成首次引导和诊断后，系统会用你的到期复习和课程进度填进具体任务。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SessionTemplatePicker />
          </CardContent>
        </Card>

        <section className="flex flex-col">
          <SectionHeader title="即将出现在这里" actions={<PhaseBadge phase={1} />} className="mb-3" />
          <div className="flex flex-col gap-3">
            {upcoming.map((item) => (
              <EmptyState
                key={item.title}
                icon={item.icon}
                title={item.title}
                description={item.description}
                className="items-start px-5 py-5 text-left [&>div]:max-w-none"
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
