import type { PlayerLesson } from "@/modules/curriculum/services/queries";

export type PlayerStep = PlayerLesson["steps"][number];
export type StepOf<T extends PlayerStep["type"]> = Extract<PlayerStep, { type: T }>;

/** Server verdict for a submitted step (no answer keys are known client-side before this). */
export type Evaluation = {
  isCorrect: boolean | null;
  selfScore: number | null;
  correctAnswer: string | null;
  modelAnswers: string[];
  explanation: string | null;
};

export type ChoiceDraft = { choice: number | null };
export type ClozeDraft = { text: string };
export type OrderDraft = { picked: number[] };
export type MatchDraft = { selections: Record<string, string> };
export type OpenDraft = { phase: "doing" | "reviewing"; text: string; hasRecording: boolean; checked: number[] };

export type StepDraft = ChoiceDraft | ClozeDraft | OrderDraft | MatchDraft | OpenDraft | null;

export type AnswerStepProps<S, D> = {
  step: S;
  draft: D;
  onDraft: (draft: D) => void;
  /** Answer submitted and evaluated: render the result, lock input. */
  evaluation: Evaluation | null;
};
