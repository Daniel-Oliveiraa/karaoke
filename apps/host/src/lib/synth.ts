"use client";

import { midiToHz, type Song } from "@jamroom/shared-types";

/**
 * Player da tela host. Dois modos:
 * - música real (song.audioUrl): toca o instrumental licenciado num <audio>;
 * - música demo: sintetiza a melodia de referência com WebAudio.
 *
 * `onStarted` dispara quando o áudio começa de verdade — o host usa para
 * reancorar o relógio do score no servidor (host:playback_started).
 */
export interface SynthPlayback {
  /** Segundos desde o início lógico da música (inclui o lead-in no demo). */
  getTime: () => number;
  stop: () => void;
}

export function playSong(
  song: Song,
  apiUrl: string,
  onStarted?: () => void
): SynthPlayback {
  if (song.audioUrl) {
    return playAudioTrack(`${apiUrl}${song.audioUrl}`, onStarted);
  }
  return playSynth(song, onStarted);
}

function playAudioTrack(src: string, onStarted?: () => void): SynthPlayback {
  const audio = new Audio(src);
  audio.preload = "auto";
  let startedNotified = false;
  audio.addEventListener("playing", () => {
    if (!startedNotified) {
      startedNotified = true;
      onStarted?.();
    }
  });
  void audio.play().catch(() => {
    // política de autoplay: tenta de novo no primeiro gesto na tela
    const resume = () => void audio.play();
    document.addEventListener("click", resume, { once: true });
    document.addEventListener("keydown", resume, { once: true });
  });
  return {
    getTime: () => audio.currentTime,
    stop: () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
  };
}

function playSynth(song: Song, onStarted?: () => void): SynthPlayback {
  const ctx = new AudioContext();
  // Política de autoplay: se o navegador criar o contexto suspenso (sem
  // gesto recente), tenta retomar já e no próximo clique/tecla na tela.
  if (ctx.state === "suspended") {
    void ctx.resume();
    const resume = () => void ctx.resume();
    document.addEventListener("click", resume, { once: true });
    document.addEventListener("keydown", resume, { once: true });
  }
  const master = ctx.createGain();
  master.gain.value = 0.25;
  master.connect(ctx.destination);

  const t0 = ctx.currentTime + 0.1;
  const beat = 60 / song.bpm;
  onStarted?.();

  // contagem de entrada: 4 cliques no lead-in
  for (let i = 0; i < 4; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = i === 0 ? 880 : 660;
    const at = t0 + i * beat;
    gain.gain.setValueAtTime(0.5, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + 0.15);
  }

  // melodia guia
  for (const note of song.notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = midiToHz(note.midi);
    const at = t0 + note.start;
    const end = at + note.duration;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.9, at + 0.03);
    gain.gain.setValueAtTime(0.9, Math.max(at + 0.03, end - 0.06));
    gain.gain.exponentialRampToValueAtTime(0.001, end);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(end + 0.05);
  }

  return {
    getTime: () => ctx.currentTime - t0,
    stop: () => {
      void ctx.close();
    },
  };
}
