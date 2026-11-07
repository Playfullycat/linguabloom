import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MobileNavBar } from "@/components/layout/mobile-nav";
import { SessionTemplatePicker } from "@/components/learning/session-template-picker";
import { SegmentedControl } from "@/components/ui/segmented-control";

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

describe("SessionTemplatePicker", () => {
  it("updates the composition when the length changes", async () => {
    render(<SessionTemplatePicker />);
    expect(screen.getByRole("list", { name: "25 分钟学习的组成" })).toBeInTheDocument();
    expect(screen.queryByText("口语或写作")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "60 分钟" }));
    expect(screen.getByRole("list", { name: "60 分钟学习的组成" })).toBeInTheDocument();
    expect(screen.getByText("口语或写作")).toBeInTheDocument();
    expect(screen.getByText("阅读或听力")).toBeInTheDocument();
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
