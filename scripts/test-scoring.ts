/**
 * Teste do algoritmo de score (ScoreTracker) com performances sintéticas:
 * - cantor perfeito → score alto;
 * - cantor uma oitava acima → igualmente alto (tolerância de oitava);
 * - cantor desafinado (+3 semitons) → score baixo;
 * - cantor mudo → zero.
 *
 * Uso: npx tsx scripts/test-scoring.ts
 */
import { midiToHz } from "../packages/shared-types/src/index";
import { FULL_CATALOG } from "../apps/api/src/catalog";
import { ScoreTracker } from "../apps/participant/src/lib/scoring";

const song = FULL_CATALOG[0]!;
const FRAME = 0.05; // ~20 fps como o worklet real

function simulate(offsetSemitones: number | null, clarity = 0.9): number {
  const tracker = new ScoreTracker(song);
  for (let t = 0; t < song.durationSec; t += FRAME) {
    const note = song.notes.find((n) => t >= n.start && t < n.start + n.duration);
    if (offsetSemitones === null || !note) {
      tracker.feed(t, null, 0);
    } else {
      tracker.feed(t, midiToHz(note.midi + offsetSemitones), clarity);
    }
  }
  return tracker.finish().score;
}

function expect(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FALHOU:", msg);
    process.exit(1);
  }
  console.log("ok -", msg);
}

const perfect = simulate(0);
const octaveUp = simulate(12);
const slightlyOff = simulate(0.4); // desvio de 40 cents, dentro da tolerância
const offKey = simulate(3);
const mute = simulate(null);

console.log({ perfect, octaveUp, slightlyOff, offKey, mute });

expect(perfect >= 900, `perfeito pontua alto (${perfect})`);
expect(octaveUp >= 900, `oitava acima vale igual (${octaveUp})`);
expect(slightlyOff >= 900, `desvio de 40 cents ainda é hit (${slightlyOff})`);
// créditos parciais nas bordas das notas (tolerância de timing) são esperados
expect(offKey <= 300, `desafinado 3 semitons pontua baixo (${offKey})`);
expect(mute === 0, `mudo pontua zero (${mute})`);
expect(perfect > offKey + 500, "diferença clara entre afinado e desafinado");

console.log("\nSCORING OK — o score reflete a afinação.");
