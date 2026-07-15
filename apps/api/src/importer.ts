import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImportJob, Song, YoutubeResult } from "@kantai/shared-types";
import { addProcessedSong, getSong } from "./catalog";

/**
 * Importação de músicas pelo app: busca no YouTube (yt-dlp) e fila SERIAL
 * de processamento (o Demucs satura a CPU — um job por vez) que delega ao
 * services/audio-processing/batch_youtube.py, o mesmo fluxo do lote:
 * download → Demucs remove a voz → pyin → letra LRCLIB→Whisper → media/.
 *
 * Uso pessoal: os itens entram com attribution "não licenciada" — nada
 * disso vale para o catálogo comercial (ver CLAUDE.md).
 */

const PYTHON = process.env.PYTHON_BIN ?? "python";
const AUDIO_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "services",
  "audio-processing"
);
const SEARCH_TIMEOUT_MS = 25_000;
const SEARCH_RESULTS = 6;
/** Fila cheia acima disso (cada job leva ~4–6 min de CPU). */
const MAX_PENDING = 5;

export async function searchYoutube(query: string): Promise<YoutubeResult[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  return new Promise((resolve) => {
    const proc = spawn(
      PYTHON,
      ["-m", "yt_dlp", `ytsearch${SEARCH_RESULTS}:${q}`, "--flat-playlist", "-J", "--no-warnings"],
      { cwd: AUDIO_DIR, windowsHide: true }
    );
    let out = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString("utf-8")));
    const timer = setTimeout(() => {
      proc.kill();
      resolve([]);
    }, SEARCH_TIMEOUT_MS);
    proc.on("error", () => {
      clearTimeout(timer);
      resolve([]);
    });
    proc.on("close", () => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(out) as {
          entries?: {
            id?: string;
            title?: string;
            uploader?: string;
            channel?: string;
            duration?: number;
          }[];
        };
        resolve(
          (data.entries ?? [])
            .filter((e) => e.id && e.title)
            .map((e) => ({
              videoId: e.id!,
              title: e.title!,
              channel: e.channel ?? e.uploader ?? "YouTube",
              durationSec: Math.round(e.duration ?? 0),
              thumbnailUrl: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
            }))
        );
      } catch {
        resolve([]);
      }
    });
  });
}

// ------------------------------------------------------------- fila de jobs

let onUpdate: (job: ImportJob) => void = () => {};
let onNewSong: (song: Song) => void = () => {};

/** index.ts pluga os broadcasts do Socket.io aqui. */
export function setImporterListeners(
  update: typeof onUpdate,
  newSong: typeof onNewSong
): void {
  onUpdate = update;
  onNewSong = newSong;
}

const queue: ImportJob[] = [];
let running: ImportJob | null = null;

export function requestImport(
  videoId: string,
  title: string,
  requesterId: string
): { ok: boolean; error?: string } {
  if (!/^[\w-]{5,20}$/.test(videoId)) {
    return { ok: false, error: "vídeo inválido" };
  }
  if (running?.videoId === videoId || queue.some((j) => j.videoId === videoId)) {
    return { ok: true }; // já pedido — não duplica
  }
  if (queue.length + (running ? 1 : 0) >= MAX_PENDING) {
    return {
      ok: false,
      error: "Fila de importação cheia — tente de novo em alguns minutos",
    };
  }
  const job: ImportJob = {
    id: randomUUID(),
    videoId,
    title: title.slice(0, 120),
    status: "queued",
    requesterId,
    progress: 0,
    stage: "Na fila",
  };
  queue.push(job);
  onUpdate(job);
  runNext();
  return { ok: true };
}

/**
 * Estágios conhecidos da saída de batch_youtube.py/pipeline.py, em ordem
 * cronológica — o progresso só sobe (nunca desce) conforme o marcador mais
 * avançado encontrado na saída acumulada do processo.
 */
const STAGES: { marker: RegExp; stage: string; progress: number }[] = [
  { marker: /baixando audio/i, stage: "Baixando áudio", progress: 5 },
  { marker: /mp3 em cache/i, stage: "Áudio em cache", progress: 15 },
  { marker: /\[1\/4\] Demucs separando vocal/, stage: "Removendo a voz (Demucs)", progress: 20 },
  { marker: /\[2\/4\] Extraindo curva de pitch/, stage: "Extraindo a melodia", progress: 60 },
  { marker: /\[3\/4\] Segmentando a curva/, stage: "Mapeando as notas", progress: 75 },
  {
    marker: /\[4\/4\] (Buscando letra sincronizada|Transcrevendo a letra)/,
    stage: "Sincronizando a letra",
    progress: 85,
  },
  { marker: /^OK: /m, stage: "Finalizando", progress: 97 },
];

/**
 * Varre a saída acumulada do processo por marcadores de estágio conhecidos e
 * atualiza `job` in-place. Retorna true se algo mudou (para disparar
 * onUpdate). Não tenta parsear a barra tqdm interna do Demucs (frágil) — o
 * client compensa a espera longa nesse estágio com uma animação de pulso.
 */
function detectProgress(buffer: string, job: ImportJob): boolean {
  let changed = false;
  for (const s of STAGES) {
    if (job.progress < s.progress && s.marker.test(buffer)) {
      job.stage = s.stage;
      job.progress = s.progress;
      changed = true;
    }
  }
  // refina o download (0–15%) interpolando o "[download] NN.N%" do yt-dlp
  if (job.progress <= 15) {
    const matches = [...buffer.matchAll(/\[download\]\s+([\d.]+)%/g)];
    const last = matches.at(-1);
    if (last) {
      const pct = Math.min(15, 5 + Math.round(parseFloat(last[1]!) * 0.1));
      if (pct > job.progress) {
        job.progress = pct;
        job.stage = "Baixando áudio";
        changed = true;
      }
    }
  }
  return changed;
}

function finish(job: ImportJob, status: "done" | "failed", extra?: Partial<ImportJob>) {
  Object.assign(job, { status, ...extra });
  onUpdate(job);
  running = null;
  runNext();
}

function runNext(): void {
  if (running || queue.length === 0) return;
  const job = queue.shift()!;
  running = job;
  job.status = "processing";
  job.stage = "Preparando...";
  job.progress = 2;
  onUpdate(job);

  const url = `https://www.youtube.com/watch?v=${job.videoId}`;
  const proc = spawn(PYTHON, ["batch_youtube.py", url], {
    cwd: AUDIO_DIR,
    windowsHide: true,
  });
  let out = "";
  const grab = (d: Buffer) => {
    out += d.toString("utf-8");
    if (out.length > 200_000) out = out.slice(-100_000);
    if (detectProgress(out, job)) onUpdate(job);
  };
  proc.stdout.on("data", grab);
  proc.stderr.on("data", grab);
  proc.on("error", (err) => finish(job, "failed", { error: String(err), stage: "Falhou" }));
  proc.on("close", (code) => {
    // batch_youtube imprime "RESULT <slug> ok|skip" por música processada
    const m = /RESULT (\S+) (ok|skip)/.exec(out);
    if (!m) {
      console.warn(`[importer] job ${job.videoId} falhou (exit ${code}):\n${out.slice(-800)}`);
      finish(job, "failed", {
        error: "processamento falhou — veja o log da API",
        stage: "Falhou",
      });
      return;
    }
    const slug = m[1]!;
    const wasNew = !getSong(slug);
    const song = addProcessedSong(slug);
    if (!song) {
      finish(job, "failed", { error: "música processada mas inválida", stage: "Falhou" });
      return;
    }
    if (wasNew) onNewSong(song);
    finish(job, "done", { songId: song.id, progress: 100, stage: "Concluído" });
  });
}
