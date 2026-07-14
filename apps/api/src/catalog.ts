import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LyricLine, MelodyNote, Song } from "@jamroom/shared-types";

/**
 * Catálogo DEMO do MVP: cantigas brasileiras de domínio público, com a
 * melodia codificada como grade de notas MIDI. A mesma grade alimenta:
 *  - o playback sintetizado na tela host (guia melódico), e
 *  - a curva de referência do scoring por pitch no participant.
 *
 * Quando o catálogo B2B licenciado entrar, este arquivo dá lugar ao banco
 * (Postgres) + pipeline de ingestão (Demucs/CREPE) — os tipos são os mesmos.
 *
 * As melodias são transcrições aproximadas de ouvido, suficientes para
 * demonstrar o produto; não são partituras oficiais.
 */

/** [midi, duração em beats] */
type NoteSpec = [number, number];

interface LineSpec {
  text: string;
  notes: NoteSpec[];
  /** Pausa depois da linha, em beats (padrão 1). */
  restAfter?: number;
}

interface SongMeta {
  id: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  coverColors: [string, string];
}

const LEAD_IN_BEATS = 4; // contagem de entrada antes da primeira nota

function buildSong(meta: SongMeta, lineSpecs: LineSpec[]): Song {
  const beat = 60 / meta.bpm;
  const notes: MelodyNote[] = [];
  const lines: LyricLine[] = [];
  let t = LEAD_IN_BEATS * beat;

  for (const spec of lineSpecs) {
    const lineStart = t;
    for (const [midi, beats] of spec.notes) {
      const duration = beats * beat;
      // midi 0 = pausa interna da linha (não vira nota de referência)
      if (midi > 0) notes.push({ start: round3(t), duration: round3(duration), midi });
      t += duration;
    }
    lines.push({ start: round3(lineStart), end: round3(t), text: spec.text });
    t += (spec.restAfter ?? 1) * beat;
  }

  return {
    ...meta,
    durationSec: round3(t + 2 * beat),
    lines,
    notes,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export const CATALOG: Song[] = [
  buildSong(
    {
      id: "ciranda-cirandinha",
      title: "Ciranda, Cirandinha",
      artist: "Cantiga popular",
      genre: "Cantiga de roda",
      bpm: 96,
      coverColors: ["#7C3AED", "#3B82F6"],
    },
    [
      {
        text: "Ciranda, cirandinha",
        notes: [[67, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [65, 0.5], [64, 0.5], [62, 1.5]],
      },
      {
        text: "Vamos todos cirandar",
        notes: [[64, 0.5], [64, 0.5], [65, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [60, 1.5]],
      },
      {
        text: "Vamos dar a meia volta",
        notes: [[67, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [65, 0.5], [64, 0.5], [62, 0.5], [62, 1]],
      },
      {
        text: "Volta e meia vamos dar",
        notes: [[64, 0.5], [64, 0.5], [65, 0.5], [67, 0.5], [64, 0.5], [62, 0.5], [60, 2]],
        restAfter: 2,
      },
      {
        text: "O anel que tu me deste",
        notes: [[67, 0.5], [67, 0.5], [67, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [64, 1.5]],
      },
      {
        text: "Era vidro e se quebrou",
        notes: [[65, 0.5], [65, 0.5], [65, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [62, 1.5]],
      },
      {
        text: "O amor que tu me tinhas",
        notes: [[67, 0.5], [67, 0.5], [67, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [64, 1.5]],
      },
      {
        text: "Era pouco e se acabou",
        notes: [[64, 0.5], [64, 0.5], [65, 0.5], [64, 0.5], [62, 0.5], [62, 0.5], [60, 2]],
      },
    ]
  ),

  buildSong(
    {
      id: "peixe-vivo",
      title: "Peixe Vivo",
      artist: "Cantiga popular",
      genre: "Cantiga de roda",
      bpm: 92,
      coverColors: ["#3B82F6", "#22C55E"],
    },
    [
      {
        text: "Como pode o peixe vivo",
        notes: [[60, 0.5], [64, 0.5], [64, 0.5], [64, 0.5], [62, 0.5], [64, 0.5], [65, 1.5]],
      },
      {
        text: "Viver fora da água fria",
        notes: [[65, 0.5], [67, 0.5], [67, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [62, 1.5]],
      },
      {
        text: "Como poderei viver",
        notes: [[62, 0.5], [67, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [62, 0.5], [60, 1.5]],
      },
      {
        text: "Sem a tua, sem a tua companhia",
        notes: [[60, 0.5], [62, 0.5], [64, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [62, 0.5], [62, 0.5], [60, 2]],
        restAfter: 2,
      },
      {
        text: "Os pastores desta aldeia",
        notes: [[67, 0.5], [67, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [65, 0.5], [64, 1.5]],
      },
      {
        text: "Já me fazem zombaria",
        notes: [[65, 0.5], [65, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [64, 0.5], [62, 1.5]],
      },
      {
        text: "Por me verem assim chorando",
        notes: [[62, 0.5], [64, 0.5], [65, 0.5], [64, 0.5], [62, 0.5], [64, 0.5], [60, 2]],
      },
    ]
  ),

  buildSong(
    {
      id: "atirei-o-pau-no-gato",
      title: "Atirei o Pau no Gato",
      artist: "Cantiga popular",
      genre: "Cantiga de roda",
      bpm: 112,
      coverColors: ["#FACC15", "#EF4444"],
    },
    [
      {
        text: "Atirei o pau no gato-tô",
        notes: [[60, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [64, 0.5], [62, 0.5], [64, 0.5], [65, 1]],
      },
      {
        text: "Mas o gato-tô não morreu-reu-reu",
        notes: [[65, 0.5], [65, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [64, 0.5], [65, 0.5], [64, 0.5], [62, 1]],
      },
      {
        text: "Dona Chica-cá admirou-se-se",
        notes: [[62, 0.5], [62, 0.5], [64, 0.5], [62, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [62, 0.5], [60, 1]],
      },
      {
        text: "Do berrô, do berrô que o gato deu",
        notes: [[60, 0.5], [64, 0.5], [64, 1], [60, 0.5], [64, 0.5], [64, 0.5], [62, 0.5], [62, 0.5], [60, 1.5]],
      },
      {
        text: "Miau!",
        notes: [[67, 2]],
      },
    ]
  ),

  buildSong(
    {
      id: "escravos-de-jo",
      title: "Escravos de Jó",
      artist: "Cantiga popular",
      genre: "Cantiga de roda",
      bpm: 104,
      coverColors: ["#7C3AED", "#D946EF"],
    },
    [
      {
        text: "Escravos de Jó jogavam caxangá",
        notes: [[64, 0.5], [64, 0.5], [64, 0.5], [62, 0.5], [64, 0.5], [65, 0.5], [65, 0.5], [65, 0.5], [64, 0.5], [65, 1.5]],
      },
      {
        text: "Tira, põe, deixa ficar",
        notes: [[67, 1], [65, 1], [64, 0.5], [64, 0.5], [62, 0.5], [62, 1.5]],
      },
      {
        text: "Guerreiros com guerreiros fazem zigue-zigue-zá",
        notes: [[60, 0.5], [62, 0.5], [64, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [62, 0.5], [62, 0.5], [64, 0.5], [62, 0.5], [60, 0.5], [62, 0.5], [60, 1.5]],
      },
      {
        text: "Guerreiros com guerreiros fazem zigue-zigue-zá",
        notes: [[60, 0.5], [62, 0.5], [64, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [62, 0.5], [62, 0.5], [64, 0.5], [62, 0.5], [60, 0.5], [62, 0.5], [60, 2]],
      },
    ]
  ),

  buildSong(
    {
      id: "marcha-soldado",
      title: "Marcha Soldado",
      artist: "Cantiga popular",
      genre: "Marchinha",
      bpm: 100,
      coverColors: ["#22C55E", "#3B82F6"],
    },
    [
      {
        text: "Marcha, soldado, cabeça de papel",
        notes: [[60, 0.5], [64, 0.5], [64, 1], [62, 0.5], [65, 0.5], [65, 1], [64, 0.5], [64, 0.5], [62, 0.5], [62, 0.5], [60, 1.5]],
      },
      {
        text: "Quem não marchar direito vai preso no quartel",
        notes: [[60, 0.5], [64, 0.5], [64, 0.5], [64, 0.5], [62, 0.5], [65, 0.5], [65, 0.5], [64, 0.5], [64, 0.5], [62, 0.5], [62, 0.5], [60, 1.5]],
      },
      {
        text: "O quartel pegou fogo, a polícia deu sinal",
        notes: [[67, 0.5], [67, 0.5], [65, 0.5], [65, 0.5], [64, 0.5], [64, 0.5], [65, 0.5], [65, 0.5], [64, 0.5], [64, 0.5], [62, 1.5]],
      },
      {
        text: "Acorda, acorda, acorda, a bandeira nacional",
        notes: [[64, 0.5], [64, 0.5], [65, 0.5], [65, 0.5], [67, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [62, 0.5], [62, 0.5], [60, 2]],
      },
    ]
  ),
];

/**
 * Músicas reais processadas pelo pipeline (services/audio-processing):
 * cada <id>.json em apps/api/media/ é um Song completo com audioUrl
 * apontando para o arquivo instrumental servido em /media.
 */
export const MEDIA_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "media"
);

function loadProcessedSongs(): Song[] {
  let entries: string[];
  try {
    entries = readdirSync(MEDIA_DIR);
  } catch {
    return []; // sem pasta media = só catálogo demo
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

const PROCESSED = loadProcessedSongs();
if (PROCESSED.length > 0) {
  console.log(
    `[catalog] ${PROCESSED.length} música(s) real(is) carregada(s):`,
    PROCESSED.map((s) => s.title).join(", ")
  );
}

export const FULL_CATALOG: Song[] = [...PROCESSED, ...CATALOG];

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
