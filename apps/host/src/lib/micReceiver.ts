"use client";

import type { MicSignalData } from "@jamroom/shared-types";
import { getSocket } from "./socket";

/**
 * Receptor da "voz na TV": aceita a oferta WebRTC do cantor da vez e toca
 * a voz nos alto-falantes da TV com a menor latência que o navegador
 * permite:
 * - `jitterBufferTarget = 0` (o Chrome mantém 30–80ms de folga por padrão);
 * - `a=ptime:10` na resposta SDP (frames Opus de 10ms em vez de 20ms);
 * - saída via WebAudio com `latencyHint: "interactive"`;
 * - reverb curto na voz — os ~50ms restantes são percebidos como efeito
 *   de karaokê, não como atraso (truque padrão da indústria).
 *
 * Também estima a latência fim-a-fim por getStats() para o medidor na tela.
 */

export interface MicStats {
  /** Estimativa total boca→alto-falante, em ms. */
  totalMs: number;
  networkMs: number;
  jitterBufferMs: number;
  outputMs: number;
  connected: boolean;
}

export interface MicReceiverManager {
  stop: () => void;
}

/** Latência fixa estimada de captura+encode no celular (não mensurável daqui). */
const CAPTURE_ENCODE_MS = 25;

function forcePtime10(sdp: string): string {
  // remove ptime existente e injeta 10ms na seção de áudio
  const cleaned = sdp.replace(/a=ptime:\d+\r\n/g, "");
  return cleaned.replace(/(m=audio[^\r\n]*\r\n)/, "$1a=ptime:10\r\n");
}

export function createMicReceiver(
  onStats: (stats: MicStats | null) => void
): MicReceiverManager {
  const socket = getSocket();

  let pc: RTCPeerConnection | null = null;
  let ctx: AudioContext | null = null;
  let sink: HTMLAudioElement | null = null;
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let currentSinger: string | null = null;
  // média por intervalo do jitter buffer (a cumulativa inclui o setup)
  let lastJbDelay = 0;
  let lastJbCount = 0;

  function teardownPeer() {
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = null;
    lastJbDelay = 0;
    lastJbCount = 0;
    pc?.close();
    pc = null;
    sink?.remove();
    sink = null;
    void ctx?.close();
    ctx = null;
    currentSinger = null;
    onStats(null);
  }

  function attachAudio(stream: MediaStream) {
    // Bug conhecido do Chrome: um MediaStream remoto de WebRTC só produz
    // áudio no WebAudio se também estiver ligado a um elemento <audio>
    // (pode ficar mudo). O elemento fica mutado; quem toca é o grafo.
    sink = new Audio();
    sink.srcObject = stream;
    sink.muted = true;
    void sink.play().catch(() => undefined);

    ctx = new AudioContext({ latencyHint: "interactive" });
    if (ctx.state === "suspended") void ctx.resume();
    const src = ctx.createMediaStreamSource(stream);

    // voz direta
    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    src.connect(dry).connect(ctx.destination);

    // reverb curto (delay com feedback filtrado) — mascara a latência
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.09;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 3200;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    src.connect(delay);
    delay.connect(damp).connect(feedback).connect(delay);
    delay.connect(wet).connect(ctx.destination);
  }

  async function collectStats() {
    if (!pc) return;
    const connected = pc.connectionState === "connected";
    let rttMs = 0;
    let jbMs = 0;
    try {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          if (typeof report.currentRoundTripTime === "number") {
            rttMs = report.currentRoundTripTime * 1000;
          }
        }
        if (report.type === "inbound-rtp" && report.kind === "audio") {
          const delay = report.jitterBufferDelay;
          const count = report.jitterBufferEmittedCount;
          if (typeof delay === "number" && typeof count === "number") {
            const dDelay = delay - lastJbDelay;
            const dCount = count - lastJbCount;
            lastJbDelay = delay;
            lastJbCount = count;
            if (dCount > 0) jbMs = (dDelay / dCount) * 1000;
          }
        }
      });
    } catch {
      return;
    }
    const outputMs =
      ((ctx && "outputLatency" in ctx && ctx.outputLatency) ||
        ctx?.baseLatency ||
        0.02) * 1000;
    onStats({
      totalMs: Math.round(CAPTURE_ENCODE_MS + rttMs / 2 + jbMs + outputMs),
      networkMs: Math.round(rttMs / 2),
      jitterBufferMs: Math.round(jbMs),
      outputMs: Math.round(outputMs),
      connected,
    });
  }

  async function handleOffer(participantId: string, sdp: string) {
    teardownPeer();
    currentSinger = participantId;
    pc = new RTCPeerConnection();

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("host:mic_signal", participantId, {
          candidate: e.candidate.toJSON(),
        });
      }
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      attachAudio(stream);
      // encolhe o jitter buffer ao mínimo (nomes variam entre versões)
      const receiver = e.receiver as RTCRtpReceiver & {
        jitterBufferTarget?: number;
        playoutDelayHint?: number;
      };
      try {
        receiver.jitterBufferTarget = 0;
      } catch {}
      try {
        receiver.playoutDelayHint = 0;
      } catch {}
    };
    pc.onconnectionstatechange = () => void collectStats();

    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    answer.sdp = forcePtime10(answer.sdp ?? "");
    await pc.setLocalDescription(answer);
    socket.emit("host:mic_signal", participantId, {
      description: { type: "answer", sdp: answer.sdp ?? "" },
    });

    statsTimer = setInterval(() => void collectStats(), 1000);
  }

  const onSignal = (payload: { participantId: string; data: MicSignalData }) => {
    const { participantId, data } = payload;
    if (data.description?.type === "offer") {
      void handleOffer(participantId, data.description.sdp);
    } else if (data.candidate && pc && participantId === currentSinger) {
      void pc.addIceCandidate(data.candidate as RTCIceCandidateInit);
    }
  };
  socket.on("jam:mic_signal", onSignal);

  return {
    stop: () => {
      socket.off("jam:mic_signal", onSignal);
      teardownPeer();
    },
  };
}
