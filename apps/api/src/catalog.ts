import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Song } from "@kantai/shared-types";

/**
 * Catálogo: músicas reais processadas pelo pipeline (services/audio-processing).
 * Cada <id>.json em apps/api/media/ é um Song completo com audioUrl
 * apontando para o arquivo instrumental servido em /media.
 *
 * (As 5 cantigas de roda demo com melodia sintetizada/grade MIDI, que
 * existiam aqui antes, foram removidas em 2026-07-16 a pedido do usuário —
 * eram só aproximações de ouvido, incorretas/pouco reconhecíveis.)
 */
// KANTAI_MEDIA_DIR sobrescreve o destino (ex.: volume persistente do
// Railway em produção); sem a env var, mantém o caminho local de sempre.
export const MEDIA_DIR =
  process.env.KANTAI_MEDIA_DIR ??
  join(fileURLToPath(new URL(".", import.meta.url)), "..", "media");

/**
 * Músicas do Josh Woodward (CC BY 4.0) removidas do catálogo em 2026-07-16
 * a pedido do usuário (artista pouco reconhecível pro público, considerado
 * "errado/desconhecido" no contexto do produto). Como o volume persistente
 * do Railway em produção já estava com esses arquivos semeados (a
 * importação inicial só roda com o volume vazio — ver CLAUDE.md seção 7),
 * um `git push` sozinho não os remove de lá: por isso o cleanup roda no
 * boot da API, idempotente, e pode ser apagado daqui a define pouco depois
 * de confirmar (via log) que sumiram da produção.
 */
const REMOVED_SONG_IDS = [
  "josh-woodward-nice-white-liberals",
  "josh-woodward-josh-woodward-crazy-glue",
  "josh-woodward-swansong",
  "words-fall-apart",
  "with-a-whimper",
  "the-nest",
  "show-me",
  "release",
  "perfect",
  "my-favorite-regret",
  "bloom",
  "princess",
  "aimless",
  "too-many-valleys",
  "after-the-flames",
  "orbit",
  "knock",
];

function removeDeprecatedSongs(): void {
  let removed = 0;
  for (const id of REMOVED_SONG_IDS) {
    for (const ext of [".json", ".mp3"]) {
      try {
        unlinkSync(join(MEDIA_DIR, `${id}${ext}`));
        removed++;
      } catch {
        // já removido ou nunca existiu nesse ambiente — ok
      }
    }
  }
  if (removed > 0) {
    console.log(`[catalog] removidas ${removed} arquivo(s) descontinuado(s) (Josh Woodward)`);
  }
}

function loadProcessedSongs(): Song[] {
  removeDeprecatedSongs();
  let entries: string[];
  try {
    entries = readdirSync(MEDIA_DIR);
  } catch {
    return []; // sem pasta media = catálogo vazio
  }
  const songs: Song[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const song = JSON.parse(
        readFileSync(join(MEDIA_DIR, name), "utf-8")
      ) as Song;
      if (song.id && song.notes?.length && song.audioUrl) songs.push(song);
    } catch (err) {
      console.warn(`[catalog] ignorando ${name}:`, err);
    }
  }
  return songs;
}

export const FULL_CATALOG: Song[] = loadProcessedSongs();
if (FULL_CATALOG.length > 0) {
  console.log(
    `[catalog] ${FULL_CATALOG.length} música(s) carregada(s):`,
    FULL_CATALOG.map((s) => s.title).join(", ")
  );
}

export function getSong(songId: string): Song | undefined {
  return FULL_CATALOG.find((s) => s.id === songId);
}

/**
 * Adiciona ao catálogo (em runtime) uma música recém-processada pelo
 * importador — mesmo critério de validação do load do boot. Retorna o Song
 * (novo ou já existente com esse id) ou undefined se o json for inválido.
 */
export function addProcessedSong(songId: string): Song | undefined {
  const existing = getSong(songId);
  if (existing) return existing;
  try {
    const song = JSON.parse(
      readFileSync(join(MEDIA_DIR, `${songId}.json`), "utf-8")
    ) as Song;
    if (!song.id || !song.notes?.length || !song.audioUrl) return undefined;
    FULL_CATALOG.unshift(song); // novas primeiro, como no boot
    return song;
  } catch (err) {
    console.warn(`[catalog] falha ao carregar ${songId}.json:`, err);
    return undefined;
  }
}
