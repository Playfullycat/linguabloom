import type { ProviderEvent } from "@/modules/speaking/domain/voice-session";

/**
 * Browser side of a realtime voice session.
 *
 * - WebRTC: the microphone track goes to the provider over a peer connection;
 *   events (transcripts, speaking state) arrive on the "oai-events" data
 *   channel. The SDP offer is sent to OUR server, which answers using a
 *   single-use credential — this page never holds any provider key.
 * - Simulated (AI_PROVIDER=mock): no media leaves the browser; a local script
 *   emits the same events so every state can be tried and tested.
 */

export type TransportHandlers = {
  onEvent: (event: ProviderEvent) => void;
  /** "open": ready; "failed": connection lost; "closed": ended on purpose. */
  onState: (state: "open" | "failed" | "closed") => void;
};

export type VoiceTransport = {
  send: (event: Record<string, unknown>) => void;
  /** Stop the AI talking right now (the learner pressed "interrupt"). */
  interrupt: () => void;
  close: () => void;
  /** Only for the simulated session. */
  simulate?: { say: (text: string) => void; drop: () => void };
};

export class ConnectError extends Error {}

async function exchangeSdp(attemptId: string, offer: string, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`/api/speaking/${attemptId}/connect`, { method: "POST", body: offer, headers: { "Content-Type": "application/sdp" }, signal });
  } catch {
    throw new ConnectError(signal.aborted ? "连接超时了。" : "连不上服务器，请检查网络。");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ConnectError(body?.error ?? "实时语音连接失败。");
  }
  return res.text();
}

export async function connectWebRTC(opts: { attemptId: string; stream: MediaStream; audio: HTMLAudioElement; signal: AbortSignal } & TransportHandlers): Promise<VoiceTransport> {
  const pc = new RTCPeerConnection();
  let closed = false;
  pc.ontrack = (e) => {
    opts.audio.srcObject = e.streams[0] ?? null;
    void opts.audio.play().catch(() => {});
  };
  for (const track of opts.stream.getAudioTracks()) pc.addTrack(track, opts.stream);
  const dc = pc.createDataChannel("oai-events");
  const send = (event: Record<string, unknown>) => {
    if (dc.readyState === "open") dc.send(JSON.stringify(event));
  };
  dc.onmessage = (ev) => {
    try {
      opts.onEvent(JSON.parse(String(ev.data)) as ProviderEvent);
    } catch {
      // Ignore malformed events.
    }
  };
  dc.onopen = () => {
    opts.onState("open");
    // The teacher speaks first (the opening line is in the session instructions).
    send({ type: "response.create" });
  };
  dc.onclose = () => {
    if (!closed) opts.onState("failed");
  };
  pc.onconnectionstatechange = () => {
    if (!closed && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) opts.onState("failed");
  };
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const answer = await exchangeSdp(opts.attemptId, offer.sdp ?? "", opts.signal);
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
  } catch (error) {
    closed = true;
    pc.close();
    throw error instanceof ConnectError ? error : new ConnectError("浏览器没能建立实时语音连接。");
  }
  return {
    send,
    interrupt: () => {
      send({ type: "response.cancel" });
      send({ type: "output_audio_buffer.clear" });
    },
    close: () => {
      closed = true;
      try {
        dc.close();
      } catch {}
      pc.getSenders().forEach((s) => s.track?.stop());
      pc.close();
      opts.audio.srcObject = null;
      opts.onState("closed");
    },
  };
}

const SIM_REPLIES = [
  "（模拟）Thank you! Can you tell me a little more?",
  "（模拟）That's nice. Why do you like it?",
  "（模拟）Great. What else can you tell me?",
  "（模拟）I see. And what about your weekend?",
  "（模拟）Good job. One more thing: who do you do it with?",
];

/** Simulated realtime session with the same events as the provider (mock only). */
export async function connectSimulated(opts: { attemptId: string; opening: string; signal: AbortSignal } & TransportHandlers): Promise<VoiceTransport> {
  // Same server path as the real thing: ownership, limits, single use, usage record.
  await exchangeSdp(opts.attemptId, "mock-offer", opts.signal);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;
  let seq = 0;
  let learnerTurns = 0;
  let speaking: string | null = null;
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!closed) fn();
    }, ms);
    timers.add(t);
  };
  const emit = (e: ProviderEvent) => {
    if (!closed) opts.onEvent(e);
  };
  const aiSays = (text: string) => {
    const id = `sim-ai-${++seq}`;
    emit({ type: "response.created", response: { id } });
    later(250, () => {
      speaking = id;
      emit({ type: "output_audio_buffer.started" });
      const words = text.split(/(?<= )/);
      words.forEach((w, i) => later(i * 60, () => speaking === id && emit({ type: "response.output_audio_transcript.delta", item_id: id, delta: w })));
      later(words.length * 60 + 900, () => {
        if (speaking !== id) return;
        emit({ type: "response.output_audio_transcript.done", item_id: id, transcript: text });
        emit({ type: "response.done", response: { id, status: "completed" } });
        emit({ type: "output_audio_buffer.stopped" });
        speaking = null;
      });
    });
  };
  const cancel = () => {
    if (!speaking) return;
    const id = speaking;
    speaking = null;
    emit({ type: "response.done", response: { id, status: "cancelled" } });
    emit({ type: "output_audio_buffer.cleared" });
  };
  later(300, () => {
    opts.onState("open");
    aiSays(opts.opening);
  });
  return {
    send: (event) => {
      if (event.type === "response.cancel") cancel();
    },
    interrupt: cancel,
    close: () => {
      closed = true;
      timers.forEach(clearTimeout);
      timers.clear();
      opts.onState("closed");
    },
    simulate: {
      say: (text) => {
        const id = `sim-learner-${++seq}`;
        // Talking over the teacher interrupts it, like server VAD does.
        if (speaking) cancel();
        emit({ type: "input_audio_buffer.speech_started", item_id: id });
        later(400, () => {
          emit({ type: "input_audio_buffer.speech_stopped", item_id: id });
          emit({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript: text });
          learnerTurns += 1;
          aiSays(learnerTurns >= 6 ? "（模拟）Thank you, that was great practice. Goodbye!" : SIM_REPLIES[(learnerTurns - 1) % SIM_REPLIES.length]!);
        });
      },
      drop: () => {
        closed = true;
        timers.forEach(clearTimeout);
        timers.clear();
        opts.onState("failed");
      },
    },
  };
}

export function supportsRealtime(): boolean {
  return typeof window !== "undefined" && typeof window.RTCPeerConnection === "function" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function supportsRecording(): boolean {
  return typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}

/** Microphone with the usual voice processing; a clear message on failure. */
export async function openMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new ConnectError("这个浏览器不能使用麦克风。");
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") throw new ConnectError("没有拿到麦克风权限。可以在浏览器地址栏允许麦克风后重试，或者改用文字回答。");
    if (name === "NotFoundError") throw new ConnectError("没有找到麦克风设备。");
    throw new ConnectError("麦克风打不开（可能被其他程序占用）。");
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}
