"use client";

import {
  hzToMidi,
  semitoneDistance,
  type MelodyNote,
  type Song,
} from "@kantai/shared-types";

/**
 * Acumulador de score de uma performance. Recebe frames de pitch com o
 * relógio local da música e compara com a grade de notas de referência.
 *
 * Regras (MVP, ajustáveis):
 * - tolerante a oitava (cantar 8ª acima/abaixo vale);
 * - frame "hit" se distância <= 1 semitom (crédito cheio) ou <= 1.75 (meio);
 * - tolerância de timing de ±250ms nas bordas das notas (relógios do host
 *   e do celular não são sincronizados com precisão);
 * - frames sem voz durante uma nota contam como erro (ponderação pela
 *   confiança do detector, como o plano recomenda para ambiente ruidoso);
 * - nota "acertada" se >= 35% dos frames dela foram hit;
 * - score final = accuracy (créditos/frames) * 1000.
 */

const CLARITY_MIN = 0.55;
const TIMING_SLACK = 0.25;

interface NoteStats {
  frames: number;
  credits: number;
}

export interface FrameJudgement {
  /** Distância em semitons até a referência mais próxima (null = sem nota ativa). */
  centsOff: number | null;
  hit: boolean;
  midi: number | null;
}

export class ScoreTracker {
  private readonly notes: MelodyNote[];
  private readonly stats: NoteStats[];

  constructor(song: Song) {
    this.notes = song.notes;
    this.stats = song.notes.map(() => ({ frames: 0, credits: 0 }));
  }

  /** Notas de referência ativas em torno de t (com folga de timing). */
  private candidates(t: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i]!;
      if (t >= n.start - TIMING_SLACK && t < n.start + n.duration + TIMING_SLACK) {
        out.push(i);
      }
      if (n.start - TIMING_SLACK > t) break;
    }
    return out;
  }

  /** Nota estritamente ativa em t (sem folga) — dona do frame para estatística. */
  private strictNoteIndex(t: number): number {
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i]!;
      if (t >= n.start && t < n.start + n.duration) return i;
      if (n.start > t) break;
    }
    return -1;
  }

  feed(t: number, hz: number | null, clarity: number): FrameJudgement {
    const strictIdx = this.strictNoteIndex(t);
    const voiced = hz !== null && clarity >= CLARITY_MIN;
    const midi = voiced ? hzToMidi(hz) : null;

    if (strictIdx < 0) {
      // fora de nota: não pontua nem penaliza (respiração/pausa)
      return { centsOff: null, hit: false, midi };
    }

    const stat = this.stats[strictIdx]!;
    stat.frames += 1;

    if (midi === null) {
      return { centsOff: null, hit: false, midi };
    }

    // melhor distância entre as candidatas (folga p/ dessincronia de relógio)
    let best = Number.POSITIVE_INFINITY;
    for (const i of this.candidates(t)) {
      best = Math.min(best, semitoneDistance(midi, this.notes[i]!.midi));
    }
    if (!Number.isFinite(best)) best = semitoneDistance(midi, this.notes[strictIdx]!.midi);

    let credit = 0;
    if (best <= 1.0) credit = 1;
    else if (best <= 1.75) credit = 0.5;
    // pondera pela clareza para não premiar detecção duvidosa
    stat.credits += credit * Math.min(1, clarity / 0.9);

    return { centsOff: best, hit: credit === 1, midi };
  }

  finish(): { score: number; accuracy: number; notesHit: number; notesTotal: number } {
    let frames = 0;
    let credits = 0;
    let notesHit = 0;
    for (const s of this.stats) {
      frames += s.frames;
      credits += s.credits;
      if (s.frames > 0 && s.credits / s.frames >= 0.35) notesHit += 1;
    }
    const accuracy = frames > 0 ? credits / frames : 0;
    return {
      score: Math.round(accuracy * 1000),
      accuracy,
      notesHit,
      notesTotal: this.notes.length,
    };
  }
}
