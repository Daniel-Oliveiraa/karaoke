"use client";

import type { MicSignalData } from "@kantai/shared-types";
import { getSocket } from "./socket";

/**
 * "Voz na TV" v3 — track Opus direto, afinado pra latência mínima.
 *
 * Histórico: a v1 usava um track Opus com as configurações default do
 * Chrome (jitter buffer NetEq com piso alto); a v2 trocou por PCM cru via
 * RTCDataChannel com ring buffer próprio na TV. Em 2026-07-16, por decisão
 * explícita do usuário, voltamos ao track Opus — mas agora espremendo cada
 * fonte de atraso que a v1 não tocava:
 *
 * - O celular NÃO reconstrói o stream: o MediaStreamTrack do microfone vai
 *   direto pro RTCPeerConnection (`addTransceiver(track, "sendonly")`).
 *   O AudioContext daqui embaixo existe SÓ pro medidor de nível da UI —
 *   o áudio enviado não passa por ele.
 * - Frames Opus de 10ms em vez dos 20ms default (`a=ptime:10` + fmtp na
 *   answer da TV, ver tuneOpusSdp) — corta ~10ms de espera de empacotamento.
 *   O algoritmo do Opus em si adiciona ~5ms de lookahead, inevitável.
 * - Mono, DTX desligado (transição de conforto/ruído atrasa o ataque da
 *   voz), CBR (bitrate constante = pacing constante, menos jitter próprio).
 * - Do lado da TV (micReceiver.ts): `receiver.jitterBufferTarget = 0`
 *   (pede ao NetEq o menor buffer que ele aceitar) e playback via WebAudio
 *   com `latencyHint: 0`, mantendo o barramento de voz (ganho + reverb).
 *
 * Sempre P2P direto na LAN (sem STUN/TURN — só candidatos "host");
 * Socket.io só relaya SDP/ICE.
 */
export interface TvMicSession {
  stop: () => void;
}

/**
 * Ajusta a seção de áudio do SDP pra latência mínima do encoder Opus.
 * DUPLICADO em apps/host/src/lib/micReceiver.ts (não há pacote compartilhado
 * de runtime entre os apps) — manter os dois em sincronia.
 *
 * O que importa de verdade é a TV aplicar isso na ANSWER: o encoder do
 * remetente obedece ao fmtp/ptime da descrição REMOTA que ele recebe.
 * Aplicar também na offer daqui é inócuo (a TV não envia áudio) mas mantém
 * os dois lados simétricos.
 */
export function tuneOpusSdp(sdp: string): string {
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

  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error("stream de microfone sem track de áudio");
  try {
    track.contentHint = "speech";
  } catch {
    // contentHint é opcional — navegador antigo só ignora
  }

  const pc = new RTCPeerConnection();
  const transceiver = pc.addTransceiver(track, {
    direction: "sendonly",
    streams: [stream],
  });
  // prioridade de rede alta (DSCP) onde o navegador suportar — best effort
  try {
    const params = transceiver.sender.getParameters();
    for (const enc of params.encodings ?? []) {
      (enc as { priority?: string; networkPriority?: string }).priority = "high";
      (enc as { priority?: string; networkPriority?: string }).networkPriority =
        "high";
    }
    await transceiver.sender.setParameters(params);
  } catch {
    // setParameters com networkPriority não é universal — sem ele funciona igual
  }

  // Medidor de nível pra UI (detecção de captura muda) — o envio de áudio
  // NÃO passa por este AudioContext (o WebRTC captura o track direto), então
  // o latencyHint daqui não afeta a latência da voz. "interactive" mantido
  // pelo efeito colateral já documentado: hints agressivos trocam o perfil
  // de áudio do mic em alguns aparelhos (mais ruído de fundo).
  const ctx = new AudioContext({ latencyHint: "interactive" });
  if (ctx.state === "suspended") await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  // cada snapshot do analyser cobre só ~43ms — acumula vários e reporta a
  // média a cada ~0.5s, senão um vale entre palavras dispara falso
  // "Sem sinal de voz" na UI
  const snapshot = new Float32Array(analyser.fftSize);
  let sumSq = 0;
  let nSamples = 0;
  let lastReport = performance.now();
  const levelTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(snapshot);
    for (let i = 0; i < snapshot.length; i++) sumSq += snapshot[i]! * snapshot[i]!;
    nSamples += snapshot.length;
    const now = performance.now();
    if (now - lastReport >= 500 && nSamples > 0) {
      lastReport = now;
      options?.onLevel?.(Math.sqrt(sumSq / nSamples));
      sumSq = 0;
      nSamples = 0;
    }
  }, 100);

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
  const tunedSdp = tuneOpusSdp(offer.sdp ?? "");
  await pc.setLocalDescription({ type: "offer", sdp: tunedSdp });
  socket.emit("participant:mic_signal", {
    description: { type: "offer", sdp: tunedSdp },
  });

  return {
    stop: () => {
      socket.off("jam:mic_signal", onSignal);
      clearInterval(levelTimer);
      source.disconnect();
      pc.close();
      // stream compartilhado pertence à detecção de pitch — não parar aqui
      if (ownsStream) {
        for (const t of stream.getTracks()) t.stop();
      }
      void ctx.close();
    },
  };
}
