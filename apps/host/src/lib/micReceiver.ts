"use client";

import type { MicSignalData } from "@jamroom/shared-types";
import { getSocket } from "./socket";

/**
 * Receptor da "voz na TV" v2: recebe PCM cru (Int16) por RTCDataChannel
 * e toca via AudioWorklet com ring buffer próprio (~30ms) — em vez do
 * jitter buffer do WebRTC, que tem piso de ~40–80ms.
 *
 * O worklet de playback faz resampling linear (taxa do celular → taxa da
 * TV) e reporta o nível real do buffer, então o medidor mostra números
 * medidos, não chutados. Reverb curto na voz mascara o atraso residual.
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

/** Captura no celular: entrada (~8ms) + pacote de 8ms. */
const CAPTURE_MS = 16;
/** Alvo do ring buffer na TV. */
const TARGET_BUFFER_MS = 30;

const PLAYER_WORKLET = `
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.srcRate = 48000;
    this.ring = new Float32Array(48000); // 1s
    this.writeIdx = 0;
    this.readIdx = 0;   // fracionário (resampling)
    this.started = false;
    this.underruns = 0;
    this.lastReport = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.type === "config") {
        this.srcRate = d.sampleRate || 48000;
        this.ring = new Float32Array(this.srcRate);
        this.writeIdx = 0;
        this.readIdx = 0;
        this.started = false;
        return;
      }
      const pcm = new Int16Array(d);
      for (let i = 0; i < pcm.length; i++) {
        this.ring[this.writeIdx % this.ring.length] = pcm[i] / 0x8000;
        this.writeIdx++;
      }
    };
  }

  fill() {
    return this.writeIdx - Math.floor(this.readIdx);
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;

    const target = (${TARGET_BUFFER_MS} / 1000) * this.srcRate;
    const ratio = this.srcRate / sampleRate;

    if (!this.started) {
      if (this.fill() >= target) this.started = true;
      else { out.fill(0); return true; }
    }

    for (let i = 0; i < out.length; i++) {
      if (this.fill() < 2) {
        // underrun: silêncio e volta a acumular até o alvo
        out.fill(0, i);
        this.started = false;
        this.underruns++;
        break;
      }
      const idx = Math.floor(this.readIdx);
      const frac = this.readIdx - idx;
      const a = this.ring[idx % this.ring.length];
      const b = this.ring[(idx + 1) % this.ring.length];
      out[i] = a + (b - a) * frac;
      this.readIdx += ratio;
    }

    // descarta excesso se o buffer crescer demais (rajada de rede)
    const maxFill = target * 3;
    if (this.fill() > maxFill) this.readIdx = this.writeIdx - target;

    if (currentTime - this.lastReport > 1) {
      this.lastReport = currentTime;
      this.port.postMessage({
        fillMs: (this.fill() / this.srcRate) * 1000,
        underruns: this.underruns,
        started: this.started,
      });
      this.underruns = 0;
    }
    return true;
  }
}
registerProcessor("jamroom-pcm-player", PcmPlayer);
`;

export function createMicReceiver(
  onStats: (stats: MicStats | null) => void
): MicReceiverManager {
  const socket = getSocket();

  let pc: RTCPeerConnection | null = null;
  let ctx: AudioContext | null = null;
  let player: AudioWorkletNode | null = null;
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let currentSinger: string | null = null;
  let lastFillMs = TARGET_BUFFER_MS;

  function teardownPeer() {
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = null;
    pc?.close();
    pc = null;
    player = null;
    void ctx?.close();
    ctx = null;
    currentSinger = null;
    lastFillMs = TARGET_BUFFER_MS;
    onStats(null);
  }

  async function setupAudio(): Promise<AudioWorkletNode> {
    ctx = new AudioContext({ latencyHint: "interactive" });
    if (ctx.state === "suspended") void ctx.resume();
    await ctx.audioWorklet.addModule(
      URL.createObjectURL(new Blob([PLAYER_WORKLET], { type: "application/javascript" }))
    );
    const node = new AudioWorkletNode(ctx, "jamroom-pcm-player", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.onmessage = (e) => {
      if (typeof e.data?.fillMs === "number") lastFillMs = e.data.fillMs;
    };

    // voz direta
    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    node.connect(dry).connect(ctx.destination);

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
    node.connect(delay);
    delay.connect(damp).connect(feedback).connect(delay);
    delay.connect(wet).connect(ctx.destination);

    return node;
  }

  async function collectStats() {
    if (!pc) return;
    const connected = pc.connectionState === "connected";
    let rttMs = 0;
    try {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          if (typeof report.currentRoundTripTime === "number") {
            rttMs = report.currentRoundTripTime * 1000;
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
      totalMs: Math.round(CAPTURE_MS + rttMs / 2 + lastFillMs + outputMs),
      networkMs: Math.round(rttMs / 2),
      jitterBufferMs: Math.round(lastFillMs),
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

    pc.ondatachannel = (e) => {
      const dc = e.channel;
      dc.binaryType = "arraybuffer";
      dc.onmessage = (msg) => {
        if (typeof msg.data === "string") {
          try {
            const header = JSON.parse(msg.data) as { type: string; sampleRate: number };
            if (header.type === "config") player?.port.postMessage(header);
          } catch {}
        } else if (player) {
          player.port.postMessage(msg.data, [msg.data as ArrayBuffer]);
        }
      };
    };

    pc.onconnectionstatechange = () => void collectStats();

    player = await setupAudio();
    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
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
