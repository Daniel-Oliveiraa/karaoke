import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImportJob, Song, YoutubeResult } from "@jamroom/shared-types";
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
  title: string
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
  };
  queue.push(job);
  onUpdate(job);
  runNext();
  return { ok: true };
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
  };
  proc.stdout.on("data", grab);
  proc.stderr.on("data", grab);
  proc.on("error", (err) => finish(job, "failed", { error: String(err) }));
  proc.on("close", (code) => {
    // batch_youtube imprime "RESULT <slug> ok|skip" por música processada
    const m = /RESULT (\S+) (ok|skip)/.exec(out);
    if (!m) {
      console.warn(`[importer] job ${job.videoId} falhou (exit ${code}):\n${out.slice(-800)}`);
      finish(job, "failed", { error: "processamento falhou — veja o log da API" });
      return;
    }
    const slug = m[1]!;
    const wasNew = !getSong(slug);
    const song = addProcessedSong(slug);
    if (!song) {
      finish(job, "failed", { error: "música processada mas inválida" });
      return;
    }
    if (wasNew) onNewSong(song);
    finish(job, "done", { songId: song.id });
  });
}
