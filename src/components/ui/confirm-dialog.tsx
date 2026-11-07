"use client";

import { AlertDialog } from "radix-ui";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

type ConfirmDialogProps = {
  /** Element that opens the dialog (usually a <Button>). */
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Server Action run on confirm (submitted as a form, works with pending state). */
  action: () => void | Promise<void>;
  tone?: "primary" | "danger";
};

/** Accessible confirmation for consequential actions (Radix AlertDialog). */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "取消",
  action,
  tone = "primary",
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-raised">
          <AlertDialog.Title className="text-lg font-semibold text-ink">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="text-sm leading-relaxed text-muted">{description}</div>
          </AlertDialog.Description>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="outline">{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <form action={action}>
              <SubmitButton variant={tone === "danger" ? "danger" : "primary"} className="w-full sm:w-auto">
                {confirmLabel}
              </SubmitButton>
            </form>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
