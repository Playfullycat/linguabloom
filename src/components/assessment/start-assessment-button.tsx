"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { startAssessmentAction } from "@/modules/assessment/actions";

/** Starts (or resumes) a diagnostic session, then re-renders the page with the runner. */
export function StartAssessmentButton({ label, variant }: { label: string; variant?: ButtonProps["variant"] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant={variant}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await startAssessmentAction();
              if (!result.ok) setError(result.error);
              else router.refresh();
            })
          }
        >
          {label}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
