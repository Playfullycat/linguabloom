import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MobileNavBar } from "@/components/layout/mobile-nav";
import { TodayPlanView } from "@/components/today/today-plan";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { skipTaskAction } from "@/modules/study-plan/actions";
import type { TodayPlan } from "@/modules/study-plan/services/plan";

vi.mock("@/modules/study-plan/actions", () => ({
  moveTaskAction: vi.fn(async () => ({ ok: true })),
  regeneratePlanAction: vi.fn(async () => ({ ok: true })),
  restoreTaskAction: vi.fn(async () => ({ ok: true })),
  skipTaskAction: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("SegmentedControl", () => {
  const options = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ] as const;

  it("reports a new choice but never an empty selection", async () => {
    const onValueChange = vi.fn();
    render(<SegmentedControl ariaLabel="test" value="a" onValueChange={onValueChange} options={options} />);

    await userEvent.click(screen.getByRole("radio", { name: "B" }));
    expect(onValueChange).toHaveBeenLastCalledWith("b");

    onValueChange.mockClear();
    await userEvent.click(screen.getByRole("radio", { name: "A" })); // already selected
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("shows no selection while the value is unknown (null)", () => {
    render(<SegmentedControl ariaLabel="test" value={null} onValueChange={vi.fn()} options={options} />);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }
  });
});

describe("TodayPlanView", () => {
  const plan: TodayPlan = {
    planDate: "2026-11-07",
    sessionMinutes: 25,
    mode: "normal",
    comeback: false,
    dueReviews: 4,
    reviewsToday: 0,
    tasks: [
      { id: "11111111-1111-4111-8111-111111111111", kind: "review", title: "复习 4 张到期卡片", href: "/review", minutes: 3, reason: "4 张卡片到期。", status: "done", skipReason: null },
      { id: "22222222-2222-4222-8222-222222222222", kind: "lesson", title: "学习：Hi and Hello（嗨与你好）", href: "/lesson/l1", minutes: 22, reason: "这是当前单元的下一课。", status: "pending", skipReason: null },
    ],
  };
  const reasons = [
    { value: "too_tired" as const, label: "有点累" },
    { value: "other" as const, label: "其他原因" },
  ];

  it("starts with the first pending task and skips with a reason", async () => {
    render(<TodayPlanView plan={plan} skipReasons={reasons} />);
    expect(screen.getByRole("link", { name: /开始学习/ })).toHaveAttribute("href", "/lesson/l1");
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上移：复习 4 张到期卡片" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "跳过" }));
    const confirm = screen.getByRole("button", { name: "确认跳过" });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByText("有点累"));
    await userEvent.click(confirm);
    expect(skipTaskAction).toHaveBeenCalledWith({ taskId: plan.tasks[1]!.id, reason: "too_tired" });
  });
});

describe("MobileNavBar", () => {
  it("marks the Learn section current on a child route", () => {
    render(<MobileNavBar pathname="/vocabulary" />);
    expect(screen.getByRole("link", { name: "Learn" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });

  it("renders without an active item while the pathname is unknown", () => {
    render(<MobileNavBar pathname={null} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });
});
