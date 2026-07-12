"use client";

import { PitchMeter, ProgressBar } from "@jamroom/ui";
import type { Jam, LivePitch, Song } from "@jamroom/shared-types";
import type { MicStats } from "@/lib/micReceiver";

/**
 * Player — música em andamento. "A TV é um palco": letra protagonista,
 * fontes enormes, poucos elementos (docs/layoutDesc_extracted.txt).
 */
export function PlayerView({
  jam,
  song,
  time,
  pitch,
  songsById,
  micStats,
}: {
  jam: Jam;
  song: Song;
  time: number;
  pitch: LivePitch | null;
  songsById: Map<string, Song>;
  micStats?: MicStats | null;
}) {
  const item = jam.queue.find((i) => i.id === jam.currentItemId);
  const singer = jam.participants.find((p) => p.id === item?.participantId);

  const currentIdx = song.lines.findIndex((l) => time >= l.start && time < l.end);
  const upcomingIdx = song.lines.findIndex((l) => l.start > time);
  const activeIdx = currentIdx >= 0 ? currentIdx : -1;
  const current = activeIdx >= 0 ? song.lines[activeIdx] : null;
  const next =
    activeIdx >= 0 ? song.lines[activeIdx + 1] : upcomingIdx >= 0 ? song.lines[upcomingIdx] : null;

  const firstLineStart = song.lines[0]?.start ?? 0;
  const leadCountdown = time < firstLineStart ? Math.ceil(firstLineStart - time) : null;

  const queued = jam.queue.filter((i) => i.status === "queued");
  const nextItem = queued[0];
  const nextSong = nextItem ? songsById.get(nextItem.songId) : undefined;

  const progress = Math.min(1, Math.max(0, time / song.durationSec));
  const remaining = Math.max(0, Math.round(song.durationSec - time));

  return (
    <main
      className="relative flex h-full flex-col"
      style={{
        background:
          "radial-gradient(120% 90% at 75% 10%, rgba(124,58,237,0.4), transparent 55%), radial-gradient(90% 70% at 20% 100%, rgba(59,130,246,0.25), transparent 60%), #09090B",
      }}
    >
      {/* medidor do protótipo "voz na TV" */}
      {micStats && (
        <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-background/70 px-4 py-1.5 backdrop-blur-glass">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              micStats.connected ? "bg-success" : "bg-warning animate-pulse"
            }`}
          />
          <span className="text-caption font-semibold text-foreground">
            Voz na TV · ~{micStats.totalMs} ms
          </span>
          <span className="text-caption text-foreground-muted">
            (rede {micStats.networkMs} · buffer {micStats.jitterBufferMs} · saída{" "}
            {micStats.outputMs})
          </span>
        </div>
      )}

      {/* cantor atual */}
      <header className="flex items-start justify-between p-12">
        <div>
          <p className="text-title font-bold">{singer?.name ?? "—"}</p>
          <p className="mt-1 text-subtitle text-foreground-muted">cantando agora</p>
        </div>
        <div className="text-right">
          <p className="text-subtitle font-semibold">{song.title}</p>
          <p className="mt-1 text-body text-foreground-muted">{song.artist}</p>
        </div>
      </header>

      {/* letra protagonista */}
      <section className="flex flex-1 flex-col items-center justify-center gap-8 px-16 text-center">
        {leadCountdown !== null ? (
          <p className="text-[8rem] font-extrabold text-primary">{leadCountdown}</p>
        ) : (
          <>
            <p
              className={
                current
                  ? "bg-gradient-to-r from-primary to-secondary bg-clip-text text-6xl font-extrabold leading-tight text-transparent"
                  : "text-6xl font-extrabold leading-tight text-foreground-muted/50"
              }
            >
              {current?.text ?? next?.text ?? "♪"}
            </p>
            {current && next && (
              <p className="text-4xl font-bold text-foreground-muted/50">{next.text}</p>
            )}
          </>
        )}

        {/* barra de afinação ao vivo */}
        <PitchMeter
          className="mt-8 w-[420px] text-center"
          centsOff={pitch?.centsOff ?? null}
          hit={pitch?.hit ?? false}
        />
      </section>

      {/* barra inferior: progresso, próxima e código */}
      <footer className="border-t border-white/10 bg-background/70 px-12 py-6 backdrop-blur-glass">
        <ProgressBar value={progress} />
        <div className="mt-4 flex items-center justify-between">
          <p className="text-body text-foreground-muted">
            {nextSong ? (
              <>
                Próxima: <span className="font-semibold text-foreground">{nextSong.title}</span>
                {" · "}
                {jam.participants.find((p) => p.id === nextItem?.participantId)?.name}
              </>
            ) : (
              "Fila vazia — adicionem a próxima pelo celular!"
            )}
          </p>
          <p className="text-body text-foreground-muted">
            {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} restantes ·
            Jam <span className="font-bold tracking-widest text-foreground">{jam.code}</span>
          </p>
        </div>
      </footer>
    </main>
  );
}
