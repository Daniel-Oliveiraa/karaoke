"use client";

import type { MicSignalData } from "@jamroom/shared-types";
import { getSocket } from "./socket";

/**
 * "Voz na TV" (protótipo): transmite a voz do cantor por WebRTC direto
 * para a tela host, otimizado para latência mínima:
 * - captura crua (sem echoCancellation/noiseSuppression/autoGainControl,
 *   cada um custa 10–30ms de processamento);
 * - sem servidores ICE: na mesma rede local os candidatos host bastam;
 * - o ajuste fino do receptor (jitter buffer, ptime) é feito na TV.
 *
 * Este stream é independente do da detecção de pitch — o score continua
 * 100% local e não é afetado pelo streaming.
 */
export interface TvMicSession {
  stop: () => void;
}

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

  const pc = new RTCPeerConnection();
  for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

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
      pc.close();
      for (const track of stream.getTracks()) track.stop();
    },
  };
}
