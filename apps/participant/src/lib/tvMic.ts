"use client";

import type { MicSignalData } from "@kantai/shared-types";
import { getSocket } from "./socket";

/**
 * "Voz na TV" v2 — latência mínima.
 *
 * Em vez de um track de áudio WebRTC (Opus + jitter buffer NetEq do Chrome,
 * piso de ~40–80ms que não controlamos), enviamos PCM cru (Int16) por um
 * RTCDataChannel não-confiável e não-ordenado. Na LAN a banda sobra
 * (bem abaixo de 1Mbps mesmo com pacotes pequenos) e o buffer de
 * reprodução passa a ser nosso (ver TARGET_BUFFER_MS no micReceiver da TV).
 *
 * Pacotes de 1 render quantum (128 amostras ≈ 2.7ms @48kHz — o mínimo que
 * o AudioWorklet entrega por vez, não dá pra empacotar menor). Perda de
 * pacote = ~2.7ms de silêncio, imperceptível numa festa; atraso acumulado
 * nunca cresce porque pacotes atrasados são simplesmente descartados
 * (maxRetransmits: 0). Pacotes menores = mais overhead de rede, irrelevante
 * na LAN, mas reduz a espera de empacotamento no celular (era 8ms c/ 3
 * chunks; ver CAPTURE_MS no micReceiver da TV).
 */
export interface TvMicSession {
  stop: () => void;
}

const CHUNKS_PER_PACKET = 1; // 128 amostras = ~2.7ms @48kHz (1 render quantum)
const MAX_BUFFERED_BYTES = 32 * 1024; // descarta se o canal congestionar

const SENDER_WORKLET = `
class PcmSender extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.sumSq = 0;
    this.nSamples = 0;
    this.lastLevel = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    this.chunks.push(ch.slice(0));
    for (let i = 0; i < ch.length; i++) this.sumSq += ch[i] * ch[i];
    this.nSamples += ch.length;
    if (this.chunks.length >= ${CHUNKS_PER_PACKET}) {
      const n = this.chunks.reduce((s, c) => s + c.length, 0);
      const out = new Int16Array(n);
      let o = 0;
      for (const c of this.chunks) {
        for (let i = 0; i < c.length; i++) {
          const v = Math.max(-1, Math.min(1, c[i]));
          out[o++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
      }
      this.port.postMessage(out.buffer, [out.buffer]);
      this.chunks = [];
    }
    // nível de voz a cada ~0.5s — a UI usa para detectar captura muda
    if (currentTime - this.lastLevel > 0.5 && this.nSamples > 0) {
      this.lastLevel = currentTime;
      this.port.postMessage({
        type: "level",
        rms: Math.sqrt(this.sumSq / this.nSamples),
      });
      this.sumSq = 0;
      this.nSamples = 0;
    }
    return true;
  }
}
registerProcessor("kantai-pcm-sender", PcmSender);
`;

export async function startTvMic(
  myParticipantId: string,
  options?: {
    /**
     * Stream de microfone já aberto (o da detecção de pitch). Reusar é
     * OBRIGATÓRIO no celular: Android entrega silêncio numa segunda
     * captura simultânea do mic.
     */
    sharedStream?: MediaStream;
    /** Nível RMS da voz enviada (~2x/s) — a UI detecta captura muda. */
    onLevel?: (rms: number) => void;
  }
): Promise<TvMicSession> {
  const socket = getSocket();

  const ownsStream = !options?.sharedStream;
  const stream =
    options?.sharedStream ??
    (await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    }));

  const ctx = new AudioContext({ latencyHint: "interactive" });
  if (ctx.state === "suspended") await ctx.resume();
  await ctx.audioWorklet.addModule(
    URL.createObjectURL(new Blob([SENDER_WORKLET], { type: "application/javascript" }))
  );

  const pc = new RTCPeerConnection();
  const dc = pc.createDataChannel("voice", {
    ordered: false,
    maxRetransmits: 0,
  });

  const source = ctx.createMediaStreamSource(stream);
  const sender = new AudioWorkletNode(ctx, "kantai-pcm-sender", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
  });
  source.connect(sender);

  dc.onopen = () => {
    // header: taxa de amostragem do celular (a TV faz o resampling)
    dc.send(JSON.stringify({ type: "config", sampleRate: ctx.sampleRate }));
    sender.port.onmessage = (
      e: MessageEvent<ArrayBuffer | { type: "level"; rms: number }>
    ) => {
      if (e.data instanceof ArrayBuffer) {
        if (dc.readyState === "open" && dc.bufferedAmount < MAX_BUFFERED_BYTES) {
          dc.send(e.data);
        }
      } else if (e.data?.type === "level") {
        options?.onLevel?.(e.data.rms);
      }
    };
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("participant:mic_signal", { candidate: e.candidate.toJSON() });
    }
  };

  // candidatos do host podem chegar antes da answer ser aplicada —
  // enfileirar até setRemoteDescription concluir
  let remoteReady = false;
  let pendingCandidates: RTCIceCandidateInit[] = [];

  const onSignal = (payload: { participantId: string; data: MicSignalData }) => {
    if (payload.participantId !== myParticipantId) return;
    const { data } = payload;
    if (data.description?.type === "answer") {
      void pc.setRemoteDescription(data.description).then(() => {
        remoteReady = true;
        for (const c of pendingCandidates) {
          void pc.addIceCandidate(c).catch(() => undefined);
        }
        pendingCandidates = [];
      });
    } else if (data.candidate) {
      const candidate = data.candidate as RTCIceCandidateInit;
      if (remoteReady) {
        void pc.addIceCandidate(candidate).catch(() => undefined);
      } else {
        pendingCandidates.push(candidate);
      }
    }
  };
  socket.on("jam:mic_signal", onSignal);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("participant:mic_signal", {
    description: { type: "offer", sdp: offer.sdp ?? "" },
  });

  return {
    stop: () => {
      socket.off("jam:mic_signal", onSignal);
      sender.port.onmessage = null;
      source.disconnect();
      sender.disconnect();
      dc.close();
      pc.close();
      // stream compartilhado pertence à detecção de pitch — não parar aqui
      if (ownsStream) {
        for (const track of stream.getTracks()) track.stop();
      }
      void ctx.close();
    },
  };
}
