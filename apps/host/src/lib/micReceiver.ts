"use client";

import type { MicSignalData } from "@kantai/shared-types";
import { MAX_TV_MICS } from "@kantai/shared-types";
import { getSocket } from "./socket";

/**
 * Receptor da "voz na TV" v2: recebe PCM cru (Int16) por RTCDataChannel
 * e toca via AudioWorklet com ring buffer próprio (~30ms) — em vez do
 * jitter buffer do WebRTC, que tem piso de ~40–80ms.
 *
 * Duetos: até MAX_TV_MICS celulares simultâneos, um peer/worklet por
 * cantor, mixados por soma no barramento de voz (com ganho reduzido por
 * peer para não clipar). O 3º celular que ofertar é ignorado.
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
  /** true = AudioContext suspenso pela política de autoplay (sem som). */
  audioBlocked: boolean;
}

export interface MicReceiverManager {
  stop: () => void;
}

/**
 * Captura no celular: ~1 render quantum de entrada (~3ms) + pacote de
 * ~2.7ms (1 chunk de 128 amostras — ver tvMic.ts). Reduzido de 16ms
 * (pacotes de 8ms/3 chunks) — ganho de ~10ms real de latência.
 */
const CAPTURE_MS = 6;
/**
 * Alvo do ring buffer na TV — a margem de segurança contra jitter de rede.
 * Motores diferentes, folgas diferentes:
 * - AudioWorklet roda numa thread de áudio dedicada (timing preciso) —
 *   aguenta um alvo mais agressivo. Reduzido de 30 para 20ms (ganho de
 *   10ms); test-tv-mic.py: 0 underruns.
 * - ScriptProcessor (fallback de contexto inseguro — é o que a TV usa
 *   quando acessada por http://<IP>, SEM https) roda na thread principal
 *   e é mais sensível a jank; já tem +~21ms de latência fixa (buffer de
 *   1024 amostras). Em 20ms o teste mostrou 1 underrun — mantido nos 30ms
 *   originais por segurança.
 * Se a voz engasgar/crepitar em Wi-Fi ruim ou com 2 celulares simultâneos,
 * suba o valor correspondente de volta; test-tv-mic.py não reproduz
 * jitter de rede real, então a validação de verdade é no ambiente de festa.
 */
const WORKLET_BUFFER_MS = 20;
const SCRIPT_PROCESSOR_BUFFER_MS = 30;

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
    this.sumSq = 0;   // energia emitida desde o ultimo report (diagnostico)
    this.sumN = 0;
    this.inSumSq = 0; // energia RECEBIDA da rede desde o ultimo report
    this.inN = 0;
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
        const v = pcm[i] / 0x8000;
        this.ring[this.writeIdx % this.ring.length] = v;
        this.writeIdx++;
        this.inSumSq += v * v;
        this.inN++;
      }
    };
  }

  fill() {
    return this.writeIdx - Math.floor(this.readIdx);
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;

    const target = (${WORKLET_BUFFER_MS} / 1000) * this.srcRate;
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
      this.sumSq += out[i] * out[i];
      this.sumN++;
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
        outRms: this.sumN ? Math.sqrt(this.sumSq / this.sumN) : 0,
        inRms: this.inN ? Math.sqrt(this.inSumSq / this.inN) : 0,
      });
      this.underruns = 0;
      this.sumSq = 0; this.sumN = 0;
      this.inSumSq = 0; this.inN = 0;
    }
    return true;
  }
}
registerProcessor("kantai-pcm-player", PcmPlayer);
`;

/** Report periódico (1s) dos motores de playback. */
interface PlayerReport {
  fillMs: number;
  underruns: number;
  started: boolean;
  /** RMS emitido ao mixer na média do último segundo. */
  outRms: number;
  /** RMS recebido da rede na média do último segundo. */
  inRms: number;
}

/** Interface comum dos dois motores de playback de PCM. */
interface VoicePlayer {
  postConfig(sampleRate: number): void;
  postPcm(data: ArrayBuffer): void;
  disconnect(): void;
}

/**
 * Fallback para contextos INSEGUROS (TV acessando http://<IP>): AudioWorklet
 * só existe em secure context, então a mesma lógica de ring buffer roda na
 * thread principal via ScriptProcessorNode (deprecated, mas universal).
 * Custo: +~21ms de latência (buffer de 1024 amostras) e mais sensível a
 * jank da thread principal.
 */
class ScriptProcessorPlayer implements VoicePlayer {
  private node: ScriptProcessorNode;
  private srcRate = 48000;
  private ring = new Float32Array(48000);
  private writeIdx = 0;
  private readIdx = 0;
  private started = false;
  private underruns = 0;
  private lastReport = 0;
  private sumSq = 0;
  private sumN = 0;
  private inSumSq = 0;
  private inN = 0;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private onReport: (r: PlayerReport) => void
  ) {
    this.node = ctx.createScriptProcessor(1024, 1, 1);
    this.node.onaudioprocess = (e) => this.process(e);
    this.node.connect(dest);
  }

  postConfig(sampleRate: number): void {
    this.srcRate = sampleRate || 48000;
    this.ring = new Float32Array(this.srcRate);
    this.writeIdx = 0;
    this.readIdx = 0;
    this.started = false;
  }

  postPcm(data: ArrayBuffer): void {
    const pcm = new Int16Array(data);
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i]! / 0x8000;
      this.ring[this.writeIdx % this.ring.length] = v;
      this.writeIdx++;
      this.inSumSq += v * v;
      this.inN++;
    }
  }

  disconnect(): void {
    this.node.disconnect();
    this.node.onaudioprocess = null;
  }

  private fill(): number {
    return this.writeIdx - Math.floor(this.readIdx);
  }

  private process(e: AudioProcessingEvent): void {
    const out = e.outputBuffer.getChannelData(0);
    const target = (SCRIPT_PROCESSOR_BUFFER_MS / 1000) * this.srcRate;
    const ratio = this.srcRate / this.ctx.sampleRate;

    if (!this.started) {
      if (this.fill() >= target) this.started = true;
      else {
        out.fill(0);
        this.report();
        return;
      }
    }

    for (let i = 0; i < out.length; i++) {
      if (this.fill() < 2) {
        out.fill(0, i);
        this.started = false;
        this.underruns++;
        break;
      }
      const idx = Math.floor(this.readIdx);
      const frac = this.readIdx - idx;
      const a = this.ring[idx % this.ring.length]!;
      const b = this.ring[(idx + 1) % this.ring.length]!;
      out[i] = a + (b - a) * frac;
      this.sumSq += out[i]! * out[i]!;
      this.sumN++;
      this.readIdx += ratio;
    }

    const maxFill = target * 3;
    if (this.fill() > maxFill) this.readIdx = this.writeIdx - target;
    this.report();
  }

  private report(): void {
    if (this.ctx.currentTime - this.lastReport <= 1) return;
    this.lastReport = this.ctx.currentTime;
    this.onReport({
      fillMs: (this.fill() / this.srcRate) * 1000,
      underruns: this.underruns,
      started: this.started,
      outRms: this.sumN ? Math.sqrt(this.sumSq / this.sumN) : 0,
      inRms: this.inN ? Math.sqrt(this.inSumSq / this.inN) : 0,
    });
    this.underruns = 0;
    this.sumSq = 0;
    this.sumN = 0;
    this.inSumSq = 0;
    this.inN = 0;
  }
}

/** Estado de uma conexão de voz (um celular). */
interface Peer {
  pc: RTCPeerConnection;
  /** Motor de playback próprio (ring buffer independente por cantor). */
  player: VoicePlayer | null;
  /** Ganho individual antes do barramento (reduzido quando há 2 vozes). */
  gain: GainNode | null;
  trackSink: HTMLAudioElement | null;
  remoteReady: boolean;
  // candidatos ICE chegam milissegundos após a oferta, antes de
  // setRemoteDescription terminar — enfileirar até lá (senão:
  // "The remote description was null")
  pendingCandidates: RTCIceCandidateInit[];
  lastFillMs: number;
  packets: number;
  bytes: number;
  // diagnóstico vindo do worklet (report de 1s)
  workletInRms: number;
  workletOutRms: number;
  workletStarted: boolean;
  underruns: number;
}

export function createMicReceiver(
  /**
   * `audioBlocked` é reportado à parte das stats por conexão: o AudioContext
   * pode nascer suspenso (autoplay) ANTES de qualquer cantor conectar, e a
   * TV precisa mostrar o aviso "clique na tela" mesmo sem conexões.
   */
  onStats: (stats: Map<string, MicStats>, audioBlocked: boolean) => void
): MicReceiverManager {
  const socket = getSocket();

  const peers = new Map<string, Peer>();
  let ctx: AudioContext | null = null;
  let voiceBus: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let workletReady: Promise<void> | null = null;
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let engine: "worklet" | "script-processor" = "worklet";

  /** Com 2 vozes somadas, reduz o ganho por peer para evitar clipping. */
  function rebalanceGains() {
    const perPeer = peers.size > 1 ? 0.7 : 1;
    for (const peer of peers.values()) {
      if (peer.gain) peer.gain.gain.value = perPeer;
    }
  }

  function teardownPeer(participantId: string) {
    const peer = peers.get(participantId);
    if (!peer) return;
    peers.delete(participantId);
    peer.pc.close();
    peer.player?.disconnect();
    peer.gain?.disconnect();
    peer.trackSink?.remove();
    rebalanceGains();
    if (peers.size === 0 && statsTimer) {
      clearInterval(statsTimer);
      statsTimer = null;
    }
    void collectStats();
  }

  function teardownAll() {
    for (const id of [...peers.keys()]) teardownPeer(id);
    void ctx?.close();
    ctx = null;
    voiceBus = null;
    analyser = null;
    workletReady = null;
    onStats(new Map(), false);
  }

  /** Contexto + barramento de voz (dry + reverb) compartilhados, 1x. */
  async function ensureAudio(): Promise<void> {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: "interactive" });
      // Política de autoplay: se a página da TV foi carregada sem nenhum
      // clique, o contexto nasce suspenso (mudo). Tenta retomar já, e de
      // novo a cada gesto até conseguir; o estado vai no MicStats para a
      // UI avisar.
      if (ctx.state === "suspended") {
        void ctx.resume();
        const resume = () => {
          if (ctx?.state === "suspended") void ctx.resume();
        };
        document.addEventListener("click", resume);
        document.addEventListener("keydown", resume);
      }
      // qualquer transição suspended↔running atualiza a UI na hora
      ctx.onstatechange = () => void collectStats();

      voiceBus = ctx.createGain();
      voiceBus.gain.value = 1;

      // medidor de sinal real (diagnóstico em __tvmic.outputRms): prova que
      // áudio decodificado está chegando ao mixer, não só pacotes na rede
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      voiceBus.connect(analyser);

      // voz direta
      const dry = ctx.createGain();
      dry.gain.value = 0.85;
      voiceBus.connect(dry).connect(ctx.destination);

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
      voiceBus.connect(delay);
      delay.connect(damp).connect(feedback).connect(delay);
      delay.connect(wet).connect(ctx.destination);

      // AudioWorklet só existe em SECURE CONTEXT (https ou localhost).
      // TV acessando http://<IP> cai no fallback de ScriptProcessor.
      if (ctx.audioWorklet) {
        engine = "worklet";
        workletReady = ctx.audioWorklet.addModule(
          URL.createObjectURL(
            new Blob([PLAYER_WORKLET], { type: "application/javascript" })
          )
        );
      } else {
        engine = "script-processor";
        workletReady = Promise.resolve();
        console.warn(
          "[tvmic] AudioWorklet indisponível (página em contexto inseguro?) — usando fallback ScriptProcessor (+~21ms)"
        );
      }
      // avisa a UI já — se nasceu suspenso, o aviso "clique na tela"
      // precisa aparecer antes mesmo de a conexão completar
      void collectStats();
    }
    await workletReady;
  }

  /** Motor de playback + ganho individual do cantor, no barramento. */
  async function createPlayer(peer: Peer): Promise<VoicePlayer> {
    await ensureAudio();
    const gain = ctx!.createGain();
    gain.connect(voiceBus!);
    peer.gain = gain;
    rebalanceGains();

    const onReport = (r: PlayerReport) => {
      peer.lastFillMs = r.fillMs;
      peer.workletInRms = r.inRms;
      peer.workletOutRms = r.outRms;
      peer.workletStarted = r.started;
      peer.underruns += r.underruns;
    };

    if (engine === "script-processor") {
      return new ScriptProcessorPlayer(ctx!, gain, onReport);
    }

    const node = new AudioWorkletNode(ctx!, "kantai-pcm-player", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.onmessage = (e) => {
      if (typeof e.data?.fillMs === "number") onReport(e.data as PlayerReport);
    };
    node.connect(gain);
    return {
      postConfig: (sampleRate) =>
        node.port.postMessage({ type: "config", sampleRate }),
      postPcm: (data) => node.port.postMessage(data, [data]),
      disconnect: () => node.disconnect(),
    };
  }

  async function collectStats() {
    const outputMs =
      ((ctx && "outputLatency" in ctx && ctx.outputLatency) ||
        ctx?.baseLatency ||
        0.02) * 1000;
    const audioBlocked = ctx !== null && ctx.state !== "running";

    const all = new Map<string, MicStats>();
    let outputRms = 0;
    if (analyser) {
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      outputRms = Math.sqrt(sum / buf.length);
    }
    const diag: Record<string, unknown> = {
      ctxState: ctx?.state,
      engine,
      outputRms: Math.round(outputRms * 10000) / 10000,
    };
    for (const [participantId, peer] of peers) {
      const connected = peer.pc.connectionState === "connected";
      let rttMs = 0;
      try {
        const stats = await peer.pc.getStats();
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            if (typeof report.currentRoundTripTime === "number") {
              rttMs = report.currentRoundTripTime * 1000;
            }
          }
        });
      } catch {
        continue;
      }
      all.set(participantId, {
        totalMs: Math.round(CAPTURE_MS + rttMs / 2 + peer.lastFillMs + outputMs),
        networkMs: Math.round(rttMs / 2),
        jitterBufferMs: Math.round(peer.lastFillMs),
        outputMs: Math.round(outputMs),
        connected,
        audioBlocked,
      });
      diag[participantId] = {
        packets: peer.packets,
        bytes: peer.bytes,
        fillMs: Math.round(peer.lastFillMs),
        connection: peer.pc.connectionState,
        inRms: Math.round(peer.workletInRms * 10000) / 10000,
        outRms: Math.round(peer.workletOutRms * 10000) / 10000,
        started: peer.workletStarted,
        underruns: peer.underruns,
      };
    }
    // diagnóstico acessível no console da TV: window.__tvmic
    (window as unknown as Record<string, unknown>).__tvmic = diag;
    onStats(all, audioBlocked);
  }

  async function handleOffer(participantId: string, sdp: string) {
    // re-oferta do mesmo cantor (toggle off/on): recria só a conexão dele
    if (peers.has(participantId)) teardownPeer(participantId);
    if (peers.size >= MAX_TV_MICS) {
      console.info(
        `[tvmic] oferta de ${participantId} ignorada: já há ${peers.size} voz(es) na TV (máx ${MAX_TV_MICS})`
      );
      return;
    }

    const pc = new RTCPeerConnection();
    const peer: Peer = {
      pc,
      player: null,
      gain: null,
      trackSink: null,
      remoteReady: false,
      pendingCandidates: [],
      lastFillMs: WORKLET_BUFFER_MS, // placeholder até o 1º report real chegar
      packets: 0,
      bytes: 0,
      workletInRms: 0,
      workletOutRms: 0,
      workletStarted: false,
      underruns: 0,
    };
    peers.set(participantId, peer);

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
            if (header.type === "config") peer.player?.postConfig(header.sampleRate);
          } catch {}
        } else if (peer.player) {
          peer.packets += 1;
          peer.bytes += (msg.data as ArrayBuffer).byteLength;
          peer.player.postPcm(msg.data as ArrayBuffer);
        }
      };
    };

    // fallback: celular rodando a versão anterior (track de áudio Opus)
    pc.ontrack = (e) => {
      if (!ctx || !voiceBus || !peer.gain) return;
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      // bug conhecido do Chrome: stream remoto só soa no WebAudio se
      // também estiver preso a um elemento <audio> (mutado)
      peer.trackSink = new Audio();
      peer.trackSink.srcObject = stream;
      peer.trackSink.muted = true;
      void peer.trackSink.play().catch(() => undefined);
      ctx.createMediaStreamSource(stream).connect(peer.gain);
    };

    pc.onconnectionstatechange = () => {
      // cantor saiu no meio (celular fechou a conexão): libera a vaga
      if (["closed", "failed", "disconnected"].includes(pc.connectionState)) {
        if (peers.get(participantId)?.pc === pc) teardownPeer(participantId);
        return;
      }
      void collectStats();
    };

    // aplicar a oferta ANTES de qualquer trabalho demorado (carregar o
    // worklet) — os candidatos do celular chegam logo atrás da oferta
    await pc.setRemoteDescription({ type: "offer", sdp });
    peer.remoteReady = true;
    for (const c of peer.pendingCandidates) {
      void pc.addIceCandidate(c).catch(() => undefined);
    }
    peer.pendingCandidates = [];

    peer.player = await createPlayer(peer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("host:mic_signal", participantId, {
      description: { type: "answer", sdp: answer.sdp ?? "" },
    });

    if (!statsTimer) statsTimer = setInterval(() => void collectStats(), 1000);
  }

  const onSignal = (payload: { participantId: string; data: MicSignalData }) => {
    const { participantId, data } = payload;
    if (data.description?.type === "offer") {
      void handleOffer(participantId, data.description.sdp);
    } else if (data.candidate) {
      const peer = peers.get(participantId);
      if (!peer) return;
      const candidate = data.candidate as RTCIceCandidateInit;
      if (peer.remoteReady) {
        void peer.pc.addIceCandidate(candidate).catch(() => undefined);
      } else {
        peer.pendingCandidates.push(candidate);
      }
    }
  };
  socket.on("jam:mic_signal", onSignal);

  return {
    stop: () => {
      socket.off("jam:mic_signal", onSignal);
      teardownAll();
    },
  };
}
