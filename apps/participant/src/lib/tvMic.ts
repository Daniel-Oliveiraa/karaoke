"use client";

import type { MicSignalData } from "@jamroom/shared-types";
import { getSocket } from "./socket";

/**
 * "Voz na TV" v2 — latência mínima.
 *
 * Em vez de um track de áudio WebRTC (Opus + jitter buffer NetEq do Chrome,
 * piso de ~40–80ms que não controlamos), enviamos PCM cru (Int16) por um
 * RTCDataChannel não-confiável e não-ordenado. Na LAN a banda sobra
 * (~768kbps) e o buffer de reprodução passa a ser nosso (~30ms, na TV).
 *
 * Pacotes de 384 amostras (8ms @48kHz). Perda de pacote = 8ms de silêncio,
 * imperceptível numa festa; atraso acumulado nunca cresce porque pacotes
 * atrasados são simplesmente descartados (maxRetransmits: 0).
 */
export interface TvMicSession {
  stop: () => void;
}

const CHUNKS_PER_PACKET = 3; // 3 × 128 amostras = 384 = 8ms @48kHz
const MAX_BUFFERED_BYTES = 32 * 1024; // descarta se o canal congestionar

const SENDER_WORKLET = `
class PcmSender extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    this.chunks.push(ch.slice(0));
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
    return true;
  }
}
registerProcessor("jamroom-pcm-sender", PcmSender);
`;

export async function startTvMic(myParticipantId: string): Promise<TvMicSession> {
  const socket = getSocket();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });

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
  const sender = new AudioWorkletNode(ctx, "jamroom-pcm-sender", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
  });
  source.connect(sender);

  dc.onopen = () => {
    // header: taxa de amostragem do celular (a TV faz o resampling)
    dc.send(JSON.stringify({ type: "config", sampleRate: ctx.sampleRate }));
    sender.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (dc.readyState === "open" && dc.bufferedAmount < MAX_BUFFERED_BYTES) {
        dc.send(e.data);
      }
    };
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("participant:mic_signal", { candidate: e.candidate.toJSON() });
    }
  };

  const onSignal = (payload: { participantId: string; data: MicSignalData }) => {
    if (payload.participantId !== myParticipantId) return;
    const { data } = payload;
    if (data.description?.type === "answer") {
      void pc.setRemoteDescription(data.description);
    } else if (data.candidate) {
      void pc.addIceCandidate(data.candidate as RTCIceCandidateInit);
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
      for (const track of stream.getTracks()) track.stop();
      void ctx.close();
    },
  };
}
