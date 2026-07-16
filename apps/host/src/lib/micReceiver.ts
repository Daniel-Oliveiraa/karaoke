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

/**
 * Motor de playback ativo — AudioWorklet exige contexto seguro (https ou
 * localhost); em http://<IP> cai no fallback ScriptProcessor (+~21ms fixos).
 * Exposto pra UI porque Smart TVs raramente têm devtools acessível — sem
 * isso não dá pra saber qual motor está rodando numa TV real sem abrir o
 * console.
 */
export type MicEngine = "worklet" | "script-processor" | null;

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

/**
 * Alvo de buffer ADAPTATIVO: os valores acima viram só o ponto de partida.
 * A cada ~1s (mesmo ciclo do collectStats), o alvo real de cada peer é
 * recalculado a partir do jitter de chegada medido de verdade (ver
 * updateJitterEstimate) — em vez de ficar chutando um número fixo e
 * torcendo pra não crepitar na festa (era assim que os valores acima foram
 * calibrados até agora). Sempre limitado entre MIN/MAX_TARGET_MS por
 * motor (garante que a adaptação nunca vira "atraso crescendo sem fim") e
 * só se move alguns ms por vez (TARGET_STEP_MS) pra não saltar — a
 * suavização do buffer (STRETCH_K/MAX_STRETCH) já lida bem com o alvo se
 * movendo aos poucos, mas um salto grande ainda seria perceptível.
 */
const WORKLET_MIN_TARGET_MS = 8;
const SCRIPT_PROCESSOR_MIN_TARGET_MS = 15;
const MAX_TARGET_MS = 60;
/** Quantas vezes o jitter medido vira margem de segurança no alvo. */
const JITTER_TARGET_MULTIPLIER = 4;
/** Passo máximo de ajuste do alvo por ciclo (~1s). */
const TARGET_STEP_MS = 2;

/**
 * Suavização do ring buffer: em vez de pular o readIdx na marra (estalo
 * audível) quando o buffer cresce demais, ou cortar pro silêncio (engasgo)
 * quando esvazia, os dois motores tocam ligeiramente mais rápido/devagar
 * (variação de taxa de resampling) até convergir de volta pro alvo —
 * mesma ideia de jitter buffer de jogos/cloud gaming (Steam Link, NetEq).
 * `STRETCH_K` controla a agressividade da correção; `MAX_STRETCH` é o teto
 * (3% ~ imperceptível em voz) que também garante que o atraso nunca cresce
 * sem limite (a correção está sempre puxando de volta pro alvo). Só resta
 * um "vazio de verdade" (fill() < 1, nada pra interpolar) como caso
 * realmente cortado — deve ficar raro com a correção contínua.
 */
const STRETCH_K = 0.02;
const MAX_STRETCH = 0.03;

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
    this.lastStretchReported = 0;
    this.targetMs = ${WORKLET_BUFFER_MS}; // ponto de partida — alvo adaptativo ajusta depois
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
      if (d && d.type === "target") {
        this.targetMs = d.ms;
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

    const target = (this.targetMs / 1000) * this.srcRate;
    const baseRatio = this.srcRate / sampleRate;

    if (!this.started) {
      if (this.fill() >= target) this.started = true;
      else { out.fill(0); return true; }
    }

    let lastStretch = 0;
    for (let i = 0; i < out.length; i++) {
      if (this.fill() < 1) {
        // vazio de verdade (nada pra interpolar): silêncio e reencher do zero
        out.fill(0, i);
        this.started = false;
        this.underruns++;
        break;
      }
      const drift = (this.fill() - target) / target;
      lastStretch = Math.max(-${MAX_STRETCH}, Math.min(${MAX_STRETCH}, drift * ${STRETCH_K}));
      const ratio = baseRatio * (1 + lastStretch);
      const idx = Math.floor(this.readIdx);
      const frac = this.readIdx - idx;
      const a = this.ring[idx % this.ring.length];
      const b = this.ring[(idx + 1) % this.ring.length];
      out[i] = a + (b - a) * frac;
      this.sumSq += out[i] * out[i];
      this.sumN++;
      this.readIdx += ratio;
    }
    this.lastStretchReported = lastStretch;

    // trava de segurança contra estouro do próprio ring (~1s de
    // capacidade) — só deveria disparar numa rajada extrema; o caso comum
    // de buffer alto já é corrigido suavemente acima, sem estalo
    const hardMax = this.ring.length * 0.9;
    if (this.fill() > hardMax) this.readIdx = this.writeIdx - target;

    if (currentTime - this.lastReport > 1) {
      this.lastReport = currentTime;
      this.port.postMessage({
        fillMs: (this.fill() / this.srcRate) * 1000,
        underruns: this.underruns,
        started: this.started,
        outRms: this.sumN ? Math.sqrt(this.sumSq / this.sumN) : 0,
        inRms: this.inN ? Math.sqrt(this.inSumSq / this.inN) : 0,
        stretch: this.lastStretchReported,
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
  /** Última correção de taxa aplicada (ver STRETCH_K/MAX_STRETCH). */
  stretch: number;
}

/** Interface comum dos dois motores de playback de PCM. */
interface VoicePlayer {
  postConfig(sampleRate: number): void;
  postPcm(data: ArrayBuffer): void;
  /** Ajusta o alvo do ring buffer em tempo real (ver alvo adaptativo). */
  setTarget(ms: number): void;
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
  private lastStretch = 0;
  private targetMs = SCRIPT_PROCESSOR_BUFFER_MS; // ponto de partida — alvo adaptativo ajusta depois

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private onReport: (r: PlayerReport) => void
  ) {
    this.node = ctx.createScriptProcessor(1024, 1, 1);
    this.node.onaudioprocess = (e) => this.process(e);
    this.node.connect(dest);
  }

  setTarget(ms: number): void {
    this.targetMs = ms;
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
    const target = (this.targetMs / 1000) * this.srcRate;
    const baseRatio = this.srcRate / this.ctx.sampleRate;

    if (!this.started) {
      if (this.fill() >= target) this.started = true;
      else {
        out.fill(0);
        this.report();
        return;
      }
    }

    for (let i = 0; i < out.length; i++) {
      if (this.fill() < 1) {
        // vazio de verdade (nada pra interpolar): silêncio e reencher do zero
        out.fill(0, i);
        this.started = false;
        this.underruns++;
        break;
      }
      const drift = (this.fill() - target) / target;
      this.lastStretch = Math.max(-MAX_STRETCH, Math.min(MAX_STRETCH, drift * STRETCH_K));
      const ratio = baseRatio * (1 + this.lastStretch);
      const idx = Math.floor(this.readIdx);
      const frac = this.readIdx - idx;
      const a = this.ring[idx % this.ring.length]!;
      const b = this.ring[(idx + 1) % this.ring.length]!;
      out[i] = a + (b - a) * frac;
      this.sumSq += out[i]! * out[i]!;
      this.sumN++;
      this.readIdx += ratio;
    }

    // trava de segurança contra estouro do próprio ring — ver comentário
    // equivalente no PLAYER_WORKLET
    const hardMax = this.ring.length * 0.9;
    if (this.fill() > hardMax) this.readIdx = this.writeIdx - target;
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
      stretch: this.lastStretch,
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
  /** Última correção de taxa aplicada pela suavização (ver STRETCH_K). */
  lastStretch: number;
  // --- medição real por pacote (seq + timestamp de captura, ver tvMic.ts) ---
  /** Última seq vista (uint32) — null até o 1º pacote chegar. */
  lastSeq: number | null;
  packetsLost: number;
  /** Fora de ordem ou duplicado (seq <= lastSeq). */
  packetsReordered: number;
  /**
   * Offset entre o relógio monotônico do celular (captureTimeUs) e o da TV
   * (performance.now()), calibrado 1x no primeiro pacote assumindo que a
   * 1ª amostra tem latência de rede ~= RTT/2 medido. Não usa Date.now()
   * (relógios de parede podem divergir entre aparelhos) — só o offset
   * relativo importa a partir daqui.
   */
  clockOffsetMs: number | null;
  /** performance.now() da última (re)calibração — ver CLOCK_RECALIBRATE_MS. */
  lastCalibrationMs: number | null;
  /**
   * Latência celular→TV (suavizada por média móvel) — EXPERIMENTAL, só
   * diagnóstico (window.__tvmic). Não usada no badge principal: calibrar
   * dois relógios independentes é frágil, ver updateOneWayLatency.
   */
  oneWayLatencyMs: number | null;
  /** Último RTT/2 medido via getStats() — usado só pra calibrar o offset acima. */
  lastRttMs: number;
  localCandidateType?: string;
  remoteCandidateType?: string;
  // --- alvo de buffer adaptativo (P3) ---
  /** Estimativa de jitter de chegada (RFC3550-like), em ms. */
  jitterEstimateMs: number;
  lastArrivalMs: number | null;
  lastCaptureUs: number | null;
  /** Alvo em uso agora (começa no valor fixo do motor, ajusta aos poucos). */
  currentTargetMs: number;
}

/**
 * Estimativa de jitter de chegada (mesma ideia do RFC3550/RTP): compara a
 * variação no intervalo de CHEGADA dos pacotes com a variação no intervalo
 * de CAPTURA (do lado do celular) — se a rede fosse perfeita, seriam iguais;
 * a diferença é jitter de verdade. Média móvel exponencial (janela ~16
 * amostras) pra não reagir a um pacote isolado fora da curva.
 */
function updateJitterEstimate(peer: Peer, captureTimeUs: number) {
  const nowMs = performance.now();
  if (peer.lastArrivalMs !== null && peer.lastCaptureUs !== null) {
    const arrivalDelta = nowMs - peer.lastArrivalMs;
    const captureDelta = (captureTimeUs - peer.lastCaptureUs) / 1000;
    const d = Math.abs(arrivalDelta - captureDelta);
    peer.jitterEstimateMs += (d - peer.jitterEstimateMs) / 16;
  }
  peer.lastArrivalMs = nowMs;
  peer.lastCaptureUs = captureTimeUs;
}

/**
 * Rastreia perda/reordenamento via número de sequência (uint32, comparação
 * segura contra wraparound — mesma técnica de RTP/TCP: trata a diferença
 * como uint32 e considera "adiantado" se < 2^31).
 */
function trackSequence(peer: Peer, seq: number) {
  if (peer.lastSeq === null) {
    peer.lastSeq = seq;
    return;
  }
  const diff = (seq - peer.lastSeq) >>> 0;
  if (diff === 0) {
    peer.packetsReordered++; // duplicado
  } else if (diff < 0x80000000) {
    if (diff > 1) peer.packetsLost += diff - 1; // gap na sequência
    peer.lastSeq = seq;
  } else {
    peer.packetsReordered++; // chegou atrasado, seq "anterior"
  }
}

/** Recalibra o offset entre os dois relógios com essa frequência (ms). */
const CLOCK_RECALIBRATE_MS = 5000;

/**
 * Atualiza a latência real (celular→TV) a partir do timestamp de captura
 * do pacote. `captureTimeUs` vem do relógio do AudioContext do CELULAR
 * (ver tvMic.ts) — dá ~71min antes de dar wrap (2^32us), sobra pra uma
 * festa; não há rebaseline automático no wrap (raro/aceitável nesse
 * intervalo).
 *
 * `performance.now()` (TV) e `AudioContext.currentTime` (celular) são dois
 * relógios independentes sem nenhuma relação fixa entre si — a calibração
 * (offset = diferença entre os dois no momento da amostra, assumindo que
 * ela teve ~RTT/2 de rede) só vale enquanto os dois relógios andarem no
 * mesmo passo. Calibrar 1x só deixa um erro inicial preso pra sempre (ex.:
 * a amostra usada pra calibrar chegou atrasada por acaso) — por isso
 * recalibra a cada CLOCK_RECALIBRATE_MS com o RTT/2 mais recente como nova
 * âncora, e o resultado nunca sai negativo (latência de rede não existe
 * negativa — se desse, é sinal de calibração ruim, não de rede rápida
 * demais).
 */
function updateOneWayLatency(peer: Peer, captureTimeUs: number) {
  const nowMs = performance.now();
  const captureMs = captureTimeUs / 1000;
  const needsCalibration =
    peer.clockOffsetMs === null ||
    peer.lastCalibrationMs === null ||
    nowMs - peer.lastCalibrationMs > CLOCK_RECALIBRATE_MS;
  if (needsCalibration) {
    const assumedOneWayMs = peer.lastRttMs > 0 ? peer.lastRttMs / 2 : 2;
    peer.clockOffsetMs = nowMs - captureMs - assumedOneWayMs;
    peer.lastCalibrationMs = nowMs;
  }
  const oneWay = Math.max(0, nowMs - captureMs - peer.clockOffsetMs!);
  peer.oneWayLatencyMs =
    peer.oneWayLatencyMs === null
      ? oneWay
      : peer.oneWayLatencyMs * 0.9 + oneWay * 0.1;
}

export function createMicReceiver(
  /**
   * `audioBlocked` é reportado à parte das stats por conexão: o AudioContext
   * pode nascer suspenso (autoplay) ANTES de qualquer cantor conectar, e a
   * TV precisa mostrar o aviso "clique na tela" mesmo sem conexões.
   * `engine` é null até a 1ª conexão inicializar o AudioContext.
   */
  onStats: (
    stats: Map<string, MicStats>,
    audioBlocked: boolean,
    engine: MicEngine
  ) => void
): MicReceiverManager {
  const socket = getSocket();

  const peers = new Map<string, Peer>();
  let ctx: AudioContext | null = null;
  let voiceBus: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let workletReady: Promise<void> | null = null;
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let engine: MicEngine = null;

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
    engine = null;
    onStats(new Map(), false, null);
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
      peer.lastStretch = r.stretch;
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
      setTarget: (ms) => node.port.postMessage({ type: "target", ms }),
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
        let pairReport: RTCIceCandidatePairStats | null = null;
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            pairReport = report as RTCIceCandidatePairStats;
          }
        });
        if (pairReport) {
          const pair = pairReport as RTCIceCandidatePairStats;
          if (typeof pair.currentRoundTripTime === "number") {
            rttMs = pair.currentRoundTripTime * 1000;
            peer.lastRttMs = rttMs;
          }
          // confirma que o áudio vai direto celular↔TV na LAN (sem STUN/TURN
          // configurado, "relay" nunca deveria aparecer aqui — ver CLAUDE.md).
          // Tipo do candidato não está no lib.dom.d.ts desta versão do TS —
          // acessa via um shape mínimo local.
          type CandidateReport = { candidateType?: string };
          const localCand = pair.localCandidateId
            ? (stats.get(pair.localCandidateId) as CandidateReport | undefined)
            : undefined;
          const remoteCand = pair.remoteCandidateId
            ? (stats.get(pair.remoteCandidateId) as CandidateReport | undefined)
            : undefined;
          peer.localCandidateType = localCand?.candidateType;
          peer.remoteCandidateType = remoteCand?.candidateType;
        }
      } catch {
        continue;
      }
      // rede: RTT/2 medido pelo WebRTC (getStats()) é o valor mostrado —
      // confiável e sempre não-negativo. `oneWayLatencyMs` (comparação
      // entre o relógio do celular e o da TV) fica só como diagnóstico em
      // __tvmic: calibrar dois relógios independentes com poucas amostras
      // é frágil de mais pra ser o número principal (deu latência negativa
      // e/ou exagerada em teste real — ver comentário em updateOneWayLatency).
      const networkMs = CAPTURE_MS + rttMs / 2;
      const received = peer.packets;
      const lossPct =
        received + peer.packetsLost > 0
          ? (peer.packetsLost / (received + peer.packetsLost)) * 100
          : 0;

      // alvo adaptativo (P3): recalcula a partir do jitter medido, mas só
      // se move alguns ms por ciclo (TARGET_STEP_MS) pra não saltar
      const minTarget =
        engine === "script-processor" ? SCRIPT_PROCESSOR_MIN_TARGET_MS : WORKLET_MIN_TARGET_MS;
      const desiredTarget = Math.min(
        MAX_TARGET_MS,
        Math.max(minTarget, minTarget + JITTER_TARGET_MULTIPLIER * peer.jitterEstimateMs)
      );
      const step = Math.max(
        -TARGET_STEP_MS,
        Math.min(TARGET_STEP_MS, desiredTarget - peer.currentTargetMs)
      );
      peer.currentTargetMs += step;
      peer.player?.setTarget(peer.currentTargetMs);

      all.set(participantId, {
        totalMs: Math.round(networkMs + peer.lastFillMs + outputMs),
        networkMs: Math.round(networkMs),
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
        // EXPERIMENTAL — não confiar de olhos fechados, ver comentário em
        // updateOneWayLatency (calibração entre relógios independentes)
        oneWayLatencyMsExperimental:
          peer.oneWayLatencyMs === null ? null : Math.round(peer.oneWayLatencyMs),
        lossPct: Math.round(lossPct * 10) / 10,
        reorderCount: peer.packetsReordered,
        candidateType: `${peer.localCandidateType ?? "?"}/${peer.remoteCandidateType ?? "?"}`,
        stretch: Math.round(peer.lastStretch * 1000) / 1000,
        jitterEstimateMs: Math.round(peer.jitterEstimateMs * 10) / 10,
        currentTargetMs: Math.round(peer.currentTargetMs * 10) / 10,
      };
    }
    // diagnóstico acessível no console da TV: window.__tvmic
    (window as unknown as Record<string, unknown>).__tvmic = diag;
    onStats(all, audioBlocked, engine);
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
      lastStretch: 0,
      lastSeq: null,
      packetsLost: 0,
      packetsReordered: 0,
      clockOffsetMs: null,
      lastCalibrationMs: null,
      oneWayLatencyMs: null,
      lastRttMs: 0,
      jitterEstimateMs: 0,
      lastArrivalMs: null,
      lastCaptureUs: null,
      currentTargetMs: WORKLET_BUFFER_MS, // corrigido pro motor certo assim que o player existir
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
          const raw = msg.data as ArrayBuffer;
          peer.packets += 1;
          peer.bytes += raw.byteLength;
          // cabeçalho de 8 bytes (seq uint32 + captureTimeUs uint32, ver
          // tvMic.ts) prefixando o PCM — extrai a metadata pro medidor real
          // de latência/perda e repassa só o áudio pro motor de playback.
          if (raw.byteLength >= 8) {
            const view = new DataView(raw);
            const captureTimeUs = view.getUint32(4);
            trackSequence(peer, view.getUint32(0));
            updateOneWayLatency(peer, captureTimeUs);
            updateJitterEstimate(peer, captureTimeUs);
            peer.player.postPcm(raw.slice(8));
          } else {
            peer.player.postPcm(raw);
          }
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
