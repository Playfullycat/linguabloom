"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Structured logging/reporting arrives with observability work (spec §11.4).
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      action={
        <Button variant="outline" onClick={() => retry()}>
          <RotateCcw aria-hidden="true" />
          再试一次
        </Button>
      }
    />
  );
}
