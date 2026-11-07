"use client";

import { useEffect, useRef } from "react";

import { recordEventAction } from "@/modules/materials/actions";

const FLUSH_EVERY_MS = 30_000;
/** No input for this long → the learner has probably stepped away. */
const IDLE_AFTER_MS = 90_000;

/**
 * Counts active study time on a material (page visible and the learner
 * interacted recently) and sends it in small slices. Idle time is not study.
 */
export function useStudyTime(contentId: string) {
  const lastActive = useRef(0);

  useEffect(() => {
    let counted = 0;
    let lastTick = Date.now();
    lastActive.current = Date.now();
    const markActive = () => {
      lastActive.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, markActive, { passive: true });

    const flush = () => {
      const ms = Math.round(counted);
      counted = 0;
      if (ms >= 1_000) void recordEventAction({ contentId, kind: "time", durationMs: ms });
    };
    const tick = setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === "visible" && now - lastActive.current < IDLE_AFTER_MS) counted += now - lastTick;
      lastTick = now;
      if (counted >= FLUSH_EVERY_MS) flush();
    }, 5_000);
    void recordEventAction({ contentId, kind: "open" });

    return () => {
      clearInterval(tick);
      for (const e of events) window.removeEventListener(e, markActive);
      flush();
    };
  }, [contentId]);
}
