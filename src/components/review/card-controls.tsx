"use client";

import { Pause, Play, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { addCardTypeAction, setCardSuspendedAction } from "@/modules/review/actions";
import { CARD_TYPE_INFO, type ReviewCardType } from "@/modules/review/domain/cards";

export function SuspendCardButton({ cardId, entryId, suspended }: { cardId: string; entryId: string; suspended: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setCardSuspendedAction(cardId, !suspended, entryId);
          router.refresh();
        })
      }
    >
      {suspended ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
      {suspended ? "恢复" : "暂停"}
    </Button>
  );
}

export function AddCardTypeButton({ entryId, cardType }: { entryId: string; cardType: ReviewCardType }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await addCardTypeAction(entryId, cardType);
          router.refresh();
        })
      }
    >
      <Plus aria-hidden="true" />
      {CARD_TYPE_INFO[cardType].label}
    </Button>
  );
}
