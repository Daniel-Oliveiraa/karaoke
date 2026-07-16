"use client";

import type { MicSignalData } from "@kantai/shared-types";
import { MAX_TV_MICS } from "@kantai/shared-types";
import { getSocket } from "./socket";

/**
 * Receptor da "voz na TV" v3 — track Opus direto, afinado pra latência
 * mínima (decisão explícita do usuário em 2026-07-16, revertendo a v2 de
 * PCM cru via DataChannel; ver o comentário de topo em
 * apps/participant/src/lib/tvMic.ts pro histórico completo).
 *
 * O MediaStreamTrack remoto é recebido DIRETO (sem reconstruir o stream,
 * sem ring buffer próprio): entra num MediaStreamAudioSourceNode e cai no
 * barramento de voz (ganho por cantor + reverb curto), preservado da v2.
 * As alavancas de latência deste lado:
 *
 * - `receiver.jitterBufferTarget = 0` (+ `playoutDelayHint = 0` legado):
 *   pede ao jitter buffer NetEq do Chrome o menor alvo que ele aceitar.
 *   O NetEq continua adaptativo por baixo (sobe sozinho se a rede piorar,
 *   e volta) — é ele quem faz o papel do alvo adaptativo que a v2
 *   implementava na mão.
 * - Answer com `a=ptime:10` + fmtp (ver tuneOpusSdp): o encoder do CELULAR
 *   obedece à descrição remota dele, que é a answer daqui — é este munge
 *   que liga os frames de 10ms de verdade.
 * - `AudioContext({ latencyHint: 0 })`: pede o menor buffer de saída que o
 *   hardware aguentar (o navegador clampa sozinho; outputMs mostra o real).
 *
 * O badge continua com números MEDIDOS: "buffer" agora é o atraso real do
 * NetEq via getStats() (jitterBufferDelay/jitterBufferEmittedCount, delta
 * por ciclo), "rede" é RTT/2 medido + estimativa fixa do caminho de envio.
 *
 * Duetos: até MAX_TV_MICS celulares simultâneos, um peer por cantor,
 * mixados no barramento (ganho reduzido por peer pra não clipar). O 3º
 * celular que ofertar é ignorado.
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
 * Motor de playback ativo — exposto pra UI porque Smart TVs raramente têm
 * devtools acessível. Na v3 só existe um motor (track Opus direto no
 * WebAudio); o valor confirma na tela que a TV está rodando a versão nova.
 */
export type MicEngine = "opus-track" | null;

export interface MicReceiverManager {
  stop: () => void;
}

/**
 * Caminho de envio do lado do celular, estimativa fixa (não dá pra medir de
 * lá): buffer de captura de hardware (~5ms) + frame Opus de 10ms (ptime
 * negociado na answer) + lookahead do encoder (~5ms). O resto do badge
 * "rede" é RTT/2 medido de verdade via getStats().
 */
const SEND_PATH_MS = 20;

/**
 * Ajusta a seção de áudio do SDP pra latência mínima do encoder Opus.
 * DUPLICADO em apps/participant/src/lib/tvMic.ts (não há pacote
 * compartilhado de runtime entre os apps) — manter os dois em sincronia.
 * Aplicado na ANSWER antes do setLocalDescription: o encoder do celular
 * obedece ao fmtp/ptime da descrição remota que ELE recebe, que é esta.
 */
function tuneOpusSdp(sdp: string): string {
  const rtpmap = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
  if (!rtpmap) return sdp;
  const pt = rtpmap[1];
  const overrides: Record<string, string> = {
    minptime: "10", // frames de 10ms (default do Chrome é 20ms)
    stereo: "0",
    "sprop-stereo": "0",
    usedtx: "0", // DTX off: sem transição silêncio→voz atrasando o ataque
    cbr: "1", // pacing constante = menos jitter gerado pelo próprio encoder
  };
  const lines = sdp.split("\r\n");
  const out: string[] = [];
  for (const line of lines) {
    // remove ptime/maxptime pré-existentes pra não duplicar
    if (line.startsWith("a=ptime:") || line.startsWith("a=maxptime:")) continue;
    if (line.startsWith(`a=fmtp:${pt} `)) {
      const kv = new Map<string, string | undefined>(
        line
          .slice(`a=fmtp:${pt} `.length)
          .split(";")
          .map((p) => {
            const [k, v] = p.split("=");
            return [k!.trim(), v] as [string, string | undefined];
          })
      );
      for (const [k, v] of Object.entries(overrides)) kv.set(k, v);
      out.push(
        `a=fmtp:${pt} ` +
          [...kv].map(([k, v]) => (v === undefined ? k : `${k}=${v}`)).join(";")
      );
      out.push("a=ptime:10");
      continue;
    }
    out.push(line);
  }
  return out.join("\r\n");
}

/**
 * Pede o menor jitter buffer possível ao receiver. `jitterBufferTarget`
 * (ms) é o caminho atual do Chrome; `playoutDelayHint` (segundos) é o
 * antecessor, mantido por compatibilidade. Nenhum dos dois está no
 * lib.dom.d.ts desta versão do TS — shape mínimo local. Reaplicado a cada
 * ciclo de stats (barato, e garante que renegociações não voltem ao default).
 */
function requestMinJitterBuffer(receiver: RTCRtpReceiver) {
  const r = receiver as unknown as {
    jitterBufferTarget?: number;
    playoutDelayHint?: number;
  };
  try {
    r.jitterBufferTarget = 0;
  } catch {
    // navegador sem suporte — o NetEq fica no alvo adaptativo default dele
  }
  try {
    r.playoutDelayHint = 0;
  } catch {
    // idem
  }
}

/** Snapshot dos contadores cumulativos do inbound-rtp (pra delta por ciclo). */
interface InboundSnapshot {
  jitterBufferDelay: number;
  jitterBufferEmittedCount: number;
  totalAudioEnergy: number;
  totalSamplesDuration: number;
  concealedSamples: number;
  totalSamplesReceived: number;
}

/** Estado de uma conexão de voz (um celular). */
interface Peer {
  pc: RTCPeerConnection;
  /** Receiver do track — onde o jitterBufferTarget=0 é (re)aplicado. */
  receiver: RTCRtpReceiver | null;
  /** Ganho individual antes do barramento (reduzido quando há 2 vozes). */
  gain: GainNode | null;
  /** Fonte WebAudio do track remoto (desconectada no teardown). */
  source: MediaStreamAudioSourceNode | null;
  /**
   * Bug conhecido do Chrome: stream remoto só soa no WebAudio se também
   * estiver preso a um elemento <audio> (mutado).
   */
  trackSink: HTMLAudioElement | null;
  remoteReady: boolean;
  // candidatos ICE chegam milissegundos após a oferta, antes de
  // setRemoteDescription terminar — enfileirar até lá (senão:
  // "The remote description was null")
  pendingCandidates: RTCIceCandidateInit[];
  // --- medições via getStats() (ciclo de ~1s) ---
  packets: number;
  bytes: number;
  packetsLost: number;
  /** Atraso médio real do NetEq no último ciclo (delta), em ms. */
  jitterBufferMs: number;
  /** RMS do áudio decodificado no último ciclo (totalAudioEnergy, delta). */
  inRms: number;
  /** % de amostras "inventadas" pelo concealment no último ciclo (perda audível). */
  concealedPct: number;
  lastRttMs: number;
  localCandidateType?: string;
  remoteCandidateType?: string;
  prev: InboundSnapshot | null;
  /** audioLevel instantâneo do inbound-rtp (nível decodificado, 0..1). */
  lastAudioLevel: number;
  lastSamplesReceived: number;
  lastSamplesDuration: number;
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
    peer.source?.disconnect();
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
    engine = null;
    onStats(new Map(), false, null);
  }

  /** Contexto + barramento de voz (dry + reverb) compartilhados, 1x. */
  function ensureAudio(): void {
    if (ctx) return;
    // latencyHint: 0 — pede explicitamente o MENOR buffer de saída
    // possível; o navegador clampa sozinho ao que o hardware aguenta
    // (ver outputMs no MicStats pro valor real escolhido). No PC do
    // usuário a saída já estava no teto de hardware (~48ms) com 0.01;
    // 0 é o pedido mais agressivo que a API aceita.
    ctx = new AudioContext({ latencyHint: 0 });
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

    engine = "opus-track";
    // avisa a UI já — se nasceu suspenso, o aviso "clique na tela"
    // precisa aparecer antes mesmo de a conexão completar
    void collectStats();
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
      // renegociação/reset não pode devolver o NetEq ao alvo default —
      // reafirma o pedido de buffer mínimo a cada ciclo (é só um setter)
      if (peer.receiver) requestMinJitterBuffer(peer.receiver);
      let rttMs = 0;
      try {
        const stats = await peer.pc.getStats();
        let pairReport: RTCIceCandidatePairStats | null = null;
        // shape mínimo local: os campos de áudio do inbound-rtp não estão
        // todos no lib.dom.d.ts desta versão do TS
        type InboundAudio = {
          kind?: string;
          packetsReceived?: number;
          packetsLost?: number;
          bytesReceived?: number;
          jitterBufferDelay?: number;
          jitterBufferEmittedCount?: number;
          totalAudioEnergy?: number;
          totalSamplesDuration?: number;
          concealedSamples?: number;
          totalSamplesReceived?: number;
          audioLevel?: number;
        };
        let inbound: InboundAudio | null = null;
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            pairReport = report as RTCIceCandidatePairStats;
          }
          if (
            report.type === "inbound-rtp" &&
            (report as InboundAudio).kind === "audio"
          ) {
            inbound = report as InboundAudio;
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
        if (inbound) {
          const inb = inbound as InboundAudio;
          peer.packets = inb.packetsReceived ?? peer.packets;
          peer.bytes = inb.bytesReceived ?? peer.bytes;
          peer.packetsLost = inb.packetsLost ?? peer.packetsLost;
          const snap: InboundSnapshot = {
            jitterBufferDelay: inb.jitterBufferDelay ?? 0,
            jitterBufferEmittedCount: inb.jitterBufferEmittedCount ?? 0,
            totalAudioEnergy: inb.totalAudioEnergy ?? 0,
            totalSamplesDuration: inb.totalSamplesDuration ?? 0,
            concealedSamples: inb.concealedSamples ?? 0,
            totalSamplesReceived: inb.totalSamplesReceived ?? 0,
          };
          const prev = peer.prev;
          // atraso médio do NetEq no ÚLTIMO ciclo (delta dos cumulativos) —
          // é o número honesto do buffer: reflete o que o jitterBufferTarget=0
          // conseguiu de verdade, não o que pedimos
          const dEmitted =
            snap.jitterBufferEmittedCount - (prev?.jitterBufferEmittedCount ?? 0);
          if (prev && dEmitted > 0) {
            peer.jitterBufferMs =
              ((snap.jitterBufferDelay - prev.jitterBufferDelay) / dEmitted) * 1000;
          } else if (!prev && snap.jitterBufferEmittedCount > 0) {
            peer.jitterBufferMs =
              (snap.jitterBufferDelay / snap.jitterBufferEmittedCount) * 1000;
          }
          const dDuration =
            snap.totalSamplesDuration - (prev?.totalSamplesDuration ?? 0);
          if (dDuration > 0) {
            peer.inRms = Math.sqrt(
              Math.max(
                0,
                (snap.totalAudioEnergy - (prev?.totalAudioEnergy ?? 0)) / dDuration
              )
            );
          }
          const dReceived =
            snap.totalSamplesReceived - (prev?.totalSamplesReceived ?? 0);
          if (dReceived > 0) {
            peer.concealedPct =
              ((snap.concealedSamples - (prev?.concealedSamples ?? 0)) /
                dReceived) *
              100;
          }
          peer.prev = snap;
          peer.lastAudioLevel = inb.audioLevel ?? 0;
          peer.lastSamplesReceived = snap.totalSamplesReceived;
          peer.lastSamplesDuration = snap.totalSamplesDuration;
        }
      } catch {
        continue;
      }
      const networkMs = SEND_PATH_MS + rttMs / 2;
      const received = peer.packets;
      const lossPct =
        received + peer.packetsLost > 0
          ? (peer.packetsLost / (received + peer.packetsLost)) * 100
          : 0;

      all.set(participantId, {
        totalMs: Math.round(networkMs + peer.jitterBufferMs + outputMs),
        networkMs: Math.round(networkMs),
        jitterBufferMs: Math.round(peer.jitterBufferMs),
        outputMs: Math.round(outputMs),
        connected,
        audioBlocked,
      });
      diag[participantId] = {
        packets: peer.packets,
        bytes: peer.bytes,
        connection: peer.pc.connectionState,
        jitterBufferMs: Math.round(peer.jitterBufferMs * 10) / 10,
        inRms: Math.round(peer.inRms * 10000) / 10000,
        audioLevel: Math.round(peer.lastAudioLevel * 10000) / 10000,
        samplesReceived: peer.lastSamplesReceived,
        samplesDuration: Math.round(peer.lastSamplesDuration * 10) / 10,
        lossPct: Math.round(lossPct * 10) / 10,
        concealedPct: Math.round(peer.concealedPct * 10) / 10,
        candidateType: `${peer.localCandidateType ?? "?"}/${peer.remoteCandidateType ?? "?"}`,
        rttMs: Math.round(peer.lastRttMs * 10) / 10,
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

    // barramento pronto ANTES do setRemoteDescription — ontrack dispara
    // durante a aplicação da oferta e precisa do gain do peer já criado
    ensureAudio();

    const pc = new RTCPeerConnection();
    const peer: Peer = {
      pc,
      receiver: null,
      gain: null,
      source: null,
      trackSink: null,
      remoteReady: false,
      pendingCandidates: [],
      packets: 0,
      bytes: 0,
      packetsLost: 0,
      jitterBufferMs: 0,
      inRms: 0,
      concealedPct: 0,
      lastRttMs: 0,
      prev: null,
      lastAudioLevel: 0,
      lastSamplesReceived: 0,
      lastSamplesDuration: 0,
    };
    peers.set(participantId, peer);

    const gain = ctx!.createGain();
    gain.connect(voiceBus!);
    peer.gain = gain;
    rebalanceGains();

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("host:mic_signal", participantId, {
          candidate: e.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (e) => {
      peer.receiver = e.receiver;
      requestMinJitterBuffer(e.receiver);
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      // bug conhecido do Chrome: stream remoto só soa no WebAudio se
      // também estiver preso a um elemento <audio> (mutado)
      peer.trackSink = new Audio();
      peer.trackSink.srcObject = stream;
      peer.trackSink.muted = true;
      void peer.trackSink.play().catch(() => undefined);
      peer.source = ctx!.createMediaStreamSource(stream);
      peer.source.connect(gain);
    };

    pc.onconnectionstatechange = () => {
      // cantor saiu no meio (celular fechou a conexão): libera a vaga
      if (["closed", "failed", "disconnected"].includes(pc.connectionState)) {
        if (peers.get(participantId)?.pc === pc) teardownPeer(participantId);
        return;
      }
      void collectStats();
    };

    await pc.setRemoteDescription({ type: "offer", sdp });
    peer.remoteReady = true;
    for (const c of peer.pendingCandidates) {
      void pc.addIceCandidate(c).catch(() => undefined);
    }
    peer.pendingCandidates = [];

    const answer = await pc.createAnswer();
    // é AQUI que os frames de 10ms ligam de verdade: o encoder do celular
    // obedece ao ptime/fmtp da answer que ele recebe (descrição remota dele)
    const tunedSdp = tuneOpusSdp(answer.sdp ?? "");
    await pc.setLocalDescription({ type: "answer", sdp: tunedSdp });
    socket.emit("host:mic_signal", participantId, {
      description: { type: "answer", sdp: tunedSdp },
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
