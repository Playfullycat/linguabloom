/** Serializable data the onboarding wizard needs (built on the server). */
export type OnboardingData = {
  step: string;
  completed: boolean;
  explanationLanguage: string;
  learningGoals: string[];
  weeklyDays: number;
  dailyMinutes: number;
  selfReportedLevel: string | null;
  diagnostic: "none" | "in_progress" | "completed";
  options: {
    languages: { value: string; label: string; detail: string }[];
    goals: { value: string; label: string }[];
    selfReports: { value: string; label: string }[];
    lengths: { value: number; detail: string }[];
  };
  summary: {
    template: string;
    start: string | null;
    startReason: string;
    estimates: { skill: string; skillLabel: string; levelLabel: string; evidenceCount: number }[];
  };
};
