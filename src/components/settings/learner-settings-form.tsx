"use client";

import { useState, useTransition, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { updateLearnerSettingsAction } from "@/modules/learner/actions";

const selectClass =
  "h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-ring";

function Field({ id, label, hint, children }: { id: string; label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export type ProfileFormValues = {
  explanationLanguage: string;
  learningGoals: string[];
  timezone: string;
  profileNotes: string;
};

/** Settings → Profile. */
export function ProfileForm({
  initial,
  languages,
  goals,
  timeZones,
}: {
  initial: ProfileFormValues;
  languages: { value: string; label: string }[];
  goals: { value: string; label: string }[];
  timeZones: string[];
}) {
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateLearnerSettingsAction({
        profile: {
          explanationLanguage: values.explanationLanguage as never,
          learningGoals: values.learningGoals as never,
          timezone: values.timezone,
          profileNotes: values.profileNotes.trim() === "" ? null : values.profileNotes,
        },
      });
      setMessage(result.ok ? { tone: "success", text: "学习者档案已保存。" } : { tone: "error", text: result.error });
    });
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="explanationLanguage" label="讲解语言">
          <select
            id="explanationLanguage"
            className={selectClass}
            value={values.explanationLanguage}
            onChange={(e) => setValues({ ...values, explanationLanguage: e.target.value })}
          >
            {languages.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="timezone" label="时区" hint="决定“今天”从几点开始、复习何时到期。">
          <select
            id="timezone"
            aria-describedby="timezone-hint"
            className={selectClass}
            value={values.timezone}
            onChange={(e) => setValues({ ...values, timezone: e.target.value })}
          >
            {timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">学习目标</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {goals.map((g) => (
            <label key={g.value} className="flex min-h-11 items-center gap-2 text-[0.9375rem] text-ink">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-primary)]"
                checked={values.learningGoals.includes(g.value)}
                onChange={() =>
                  setValues({
                    ...values,
                    learningGoals: values.learningGoals.includes(g.value)
                      ? values.learningGoals.filter((x) => x !== g.value)
                      : [...values.learningGoals, g.value],
                  })
                }
              />
              {g.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field id="profileNotes" label="备注（可选）" hint="例如想重点练的场景。只保存在你自己的数据库里。">
        <textarea
          id="profileNotes"
          aria-describedby="profileNotes-hint"
          rows={3}
          maxLength={1000}
          value={values.profileNotes}
          onChange={(e) => setValues({ ...values, profileNotes: e.target.value })}
          className="w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 py-3 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-ring"
        />
      </Field>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
      <div>
        <Button type="submit" disabled={pending}>
          保存档案
        </Button>
      </div>
    </form>
  );
}

export type PlanFormValues = {
  dailyMinutes: number;
  weeklyDays: number;
  newItemsLimit: number;
  showWeeklyStreak: boolean;
};

/** Settings → Study Plan. */
export function StudyPlanForm({ initial, lengths }: { initial: PlanFormValues; lengths: readonly number[] }) {
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const result = await updateLearnerSettingsAction({ preferences: values });
          setMessage(
            result.ok ? { tone: "success", text: "学习计划已保存。新的时长从明天的计划开始生效；今天可以在“今日”页直接切换。" } : { tone: "error", text: result.error },
          );
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="dailyMinutes" label="每次学习时长">
          <select
            id="dailyMinutes"
            className={selectClass}
            value={values.dailyMinutes}
            onChange={(e) => setValues({ ...values, dailyMinutes: Number(e.target.value) })}
          >
            {lengths.map((n) => (
              <option key={n} value={n}>
                {n} 分钟
              </option>
            ))}
          </select>
        </Field>
        <Field id="weeklyDays" label="每周学习天数">
          <select
            id="weeklyDays"
            className={selectClass}
            value={values.weeklyDays}
            onChange={(e) => setValues({ ...values, weeklyDays: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n} 天
              </option>
            ))}
          </select>
        </Field>
        <Field id="newItemsLimit" label="每天新卡上限" hint="0–100。累了可以调低，复习量会跟着变少。">
          <input
            id="newItemsLimit"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            aria-describedby="newItemsLimit-hint"
            className={selectClass}
            value={values.newItemsLimit}
            onChange={(e) => setValues({ ...values, newItemsLimit: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })}
          />
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-[0.9375rem] text-ink">
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-primary)]"
          checked={values.showWeeklyStreak}
          onChange={(e) => setValues({ ...values, showWeeklyStreak: e.target.checked })}
        />
        在“今日”显示本周已学天数（只做提醒，断了也不会清零或扣分）
      </label>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
      <div>
        <Button type="submit" disabled={pending}>
          保存学习计划
        </Button>
      </div>
    </form>
  );
}
