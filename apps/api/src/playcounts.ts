import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Contagem global de reproduções por música (todas as Jams), persistida em
 * data/playcounts.json — alimenta a aba "Mais tocadas" do participant.
 * Mesmo padrão de snapshot debounced do store.ts.
 */

const DATA_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "playcounts.json"
);

const counts = new Map<string, number>();

try {
  const raw = JSON.parse(readFileSync(DATA_FILE, "utf-8")) as Record<string, number>;
  for (const [id, n] of Object.entries(raw)) {
    if (typeof n === "number" && n > 0) counts.set(id, n);
  }
} catch {
  // primeiro boot ou arquivo inválido — começa zerado
}

let saveTimer: NodeJS.Timeout | null = null;

function scheduleSaveCounts(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(DATA_FILE), { recursive: true });
      writeFileSync(DATA_FILE, JSON.stringify(Object.fromEntries(counts)), "utf-8");
    } catch (err) {
      console.warn("[playcounts] falha ao salvar:", err);
    }
  }, 300);
  saveTimer.unref();
}

export function bumpPlayCount(songId: string): void {
  counts.set(songId, (counts.get(songId) ?? 0) + 1);
  scheduleSaveCounts();
}

export function playCountOf(songId: string): number {
  return counts.get(songId) ?? 0;
}
