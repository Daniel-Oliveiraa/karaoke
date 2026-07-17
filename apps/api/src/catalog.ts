import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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

/**
 * Semente original da imagem Docker (ver docker/api-entrypoint.sh) — só
 * existe dentro do container, não no dev local. O entrypoint só copia
 * semente → volume quando o volume está VAZIO; então quando um arquivo já
 * existente no volume é corrigido (não removido) na imagem — ex.: letra
 * de uma música corrigida em 2026-07-16 — o redeploy sozinho não propaga a
 * correção pro volume. Esta lista força a re-sincronização desses ids
 * específicos a partir da semente, todo boot (idempotente — sobrescreve
 * sempre com o mesmo conteúdo da imagem atual). Pode ser esvaziada quando
 * não houver mais correções pendentes de propagar.
 */
const SEED_MEDIA_DIR = "/app/seed/media";
const REFRESH_FROM_SEED_IDS = [
  "anitta-part-projota-cobertor",
  "anitta-part-cone-crew-sim",
  "anitta-part-jhama-essa-mina-e-louca",
  "anitta-part-vitin-cravo-e-canela",
  "shawn-mendes-stitches",
  "scalene-danse-macabre-clipe-real-surreal",
  "vanguart-meu-sol-videoclipe-oficial",
  "ivete-sangalo-alexandre-carlo-could-you-be-loved-citacao-mus",
];

function refreshFixedSongsFromSeed(): void {
  if (!existsSync(SEED_MEDIA_DIR)) return; // dev local: sem semente, nada a fazer
  let refreshed = 0;
  for (const id of REFRESH_FROM_SEED_IDS) {
    try {
      const content = readFileSync(join(SEED_MEDIA_DIR, `${id}.json`), "utf-8");
      writeFileSync(join(MEDIA_DIR, `${id}.json`), content);
      refreshed++;
    } catch {
      // sem essa música na semente atual (nunca existiu, ou já foi
      // removida por removeDeprecatedSongs) — ok
    }
  }
  if (refreshed > 0) {
    console.log(`[catalog] re-sincronizado(s) ${refreshed} arquivo(s) a partir da semente da imagem`);
  }
}

function loadProcessedSongs(): Song[] {
  removeDeprecatedSongs();
  refreshFixedSongsFromSeed();
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
