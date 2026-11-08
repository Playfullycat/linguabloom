"use client";

import { Keyboard, Mic, Radio, ShieldCheck } from "lucide-react";
import { useState, useSyncExternalStore, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { startSpeakingAction } from "@/modules/speaking/actions";

import { RealtimeSession } from "./realtime-session";
import { ScriptedSession } from "./scripted-session";
import { StandardSession } from "./standard-session";
import { supportsRealtime, supportsRecording } from "./voice-transport";

export type LabProps = {
  task: { id: string; type: string; scripted: boolean; opening: string | null; items: string[] };
  defaults: { saveTranscript: boolean; saveAudio: boolean };
  ai: { available: boolean; simulated: boolean; providerLabel: string; realtime: boolean; transcription: boolean; speech: boolean; unavailableReason: string | null };
};

type Mode = "realtime" | "standard" | "typed";
type Started = { id: string; mode: Mode; transport: "webrtc" | "simulated" | null; maxSeconds: number; speech: boolean; saveAudio: boolean };

const noop = () => () => {};

/**
 * Before anything is recorded the learner sees (spec §11.2): whether the
 * recording is kept, whether the transcript is kept, and that the voice goes
 * to a third-party AI provider. Then the best available mode is offered:
 * realtime → standard (record, transcribe, reply, speak) → typing.
 */
export function SpeakingLab({ task, defaults, ai }: LabProps) {
  const realtimeOk = useSyncExternalStore(noop, supportsRealtime, () => true);
  const recordOk = useSyncExternalStore(noop, supportsRecording, () => true);
  const [saveTranscript, setSaveTranscript] = useState(defaults.saveTranscript);
  const [saveAudio, setSaveAudio] = useState(defaults.saveAudio);
  const [started, setStarted] = useState<Started | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = (mode: Mode, why?: string) =>
    startTransition(async () => {
      setError(null);
      setNotice(why ?? null);
      const r = await startSpeakingAction({ taskId: task.id, mode, saveTranscript, saveAudio: mode !== "typed" && saveAudio });
      if (!r.ok) return setError(r.error);
      setStarted({ id: r.data.id, mode, transport: r.data.transport, maxSeconds: r.data.maxSeconds, speech: r.data.speech, saveAudio: mode !== "typed" && saveAudio });
    });

  if (!ai.available) {
    return (
      <div className="rounded-2xl border border-border bg-surface-soft/60 p-4 text-sm text-muted">
        口语练习需要 AI（{ai.unavailableReason}）。课程里的跟读录音不需要 AI，照常可用。
      </div>
    );
  }

  if (started) {
    return (
      <div className="flex flex-col gap-3" data-testid="speaking-session">
        {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
        {started.mode === "realtime" ? (
          <RealtimeSession
            attemptId={started.id}
            transport={started.transport ?? "simulated"}
            opening={task.opening ?? ""}
            maxSeconds={started.maxSeconds}
            saveAudio={started.saveAudio}
            onFallback={() => {
              setStarted(null);
              if (ai.transcription && recordOk) start("standard", "已改用标准语音模式：每次录一句，再转写和回复。上一段实时对话保存在练习记录里（可以在那里生成反馈）。");
              else start("typed", "已改用文字回答。");
            }}
          />
        ) : task.scripted ? (
          <ScriptedSession attemptId={started.id} type={task.type as "read_aloud"} items={task.items} providerSpeech={started.speech} />
        ) : (
          <StandardSession attemptId={started.id} mode={started.mode} opening={task.opening ?? ""} providerSpeech={started.speech} />
        )}
      </div>
    );
  }

  const canRealtime = !task.scripted && ai.realtime && realtimeOk;
  const canStandard = ai.transcription && recordOk;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2 rounded-2xl border border-border bg-surface-soft/60 p-4">
        <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold text-ink">
          <ShieldCheck className="size-4" aria-hidden="true" />
          开始前请确认
        </legend>
        <p className="text-sm text-muted" data-testid="speaking-consent">
          {ai.simulated
            ? "当前是模拟 AI（AI_PROVIDER=mock）：你的声音不会发给任何外部服务，老师的回复是模拟的。"
            : `你的声音和文字会发送给第三方 AI 服务（${ai.providerLabel}）做语音识别和回复。`}
        </p>
        <label className="flex min-h-11 items-center gap-2 text-[0.9375rem] text-ink">
          <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={saveTranscript} onChange={(e) => setSaveTranscript(e.target.checked)} />
          保存这次的文字转录（可以之后查看、删除）
        </label>
        <label className="flex min-h-11 items-center gap-2 text-[0.9375rem] text-ink">
          <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={saveAudio} onChange={(e) => setSaveAudio(e.target.checked)} />
          保存我的录音（只录你自己的麦克风；默认不保存）
        </label>
        <p className="text-xs text-muted">
          {saveAudio ? "录音会保存在这台服务器上，可以重听，也可以随时删除。" : "不保存录音：声音只用于这次识别，不会存到服务器上。"}
          {saveTranscript ? "" : " 不保存转录时，只保存反馈（反馈里可能引用你说过的个别短句）。"}
          默认选项可以在「设置 → 隐私」里修改。
        </p>
      </fieldset>

      {!task.scripted && ai.realtime && !realtimeOk ? <FormMessage tone="error">这个浏览器不支持实时语音（WebRTC），可以用下面的标准语音模式。</FormMessage> : null}
      {!recordOk ? <FormMessage tone="error">这个浏览器不能录音（或没有麦克风权限接口）。{task.scripted ? "朗读和跟读任务需要录音。" : "可以用文字回答。"}</FormMessage> : null}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}

      <div className="flex flex-wrap gap-2">
        {canRealtime ? (
          <Button onClick={() => start("realtime")} disabled={pending}>
            <Radio aria-hidden="true" />
            开始实时对话
          </Button>
        ) : null}
        {canStandard ? (
          <Button variant={canRealtime ? "outline" : "primary"} onClick={() => start("standard")} disabled={pending}>
            <Mic aria-hidden="true" />
            {task.scripted ? "开始录音练习" : "标准语音模式"}
          </Button>
        ) : null}
        {!task.scripted ? (
          <Button variant="ghost" onClick={() => start("typed")} disabled={pending}>
            <Keyboard aria-hidden="true" />
            用文字回答
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        {task.scripted
          ? "朗读 / 跟读：每句录音后转写，对照原句看哪些词被识别到。"
          : canRealtime
            ? "实时对话像打电话一样，可以随时打断老师。网络不好时可以用标准语音模式：录一句、转写、老师回复。"
            : "标准语音模式：录一句、转写、老师回复，再朗读给你听。不是实时对话。"}
      </p>
    </div>
  );
}
