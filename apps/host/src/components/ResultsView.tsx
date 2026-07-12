"use client";

import { Avatar } from "@jamroom/ui";
import type { Jam, Song } from "@jamroom/shared-types";
import { LeaderboardPanel } from "./LeaderboardPanel";

function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-12 w-12 ${filled ? "text-warning" : "text-surface-elevated"}`}
      fill="currentColor"
    >
      <path d="M12 2.5l2.9 6.06 6.6.83-4.86 4.5 1.28 6.53L12 17.14l-5.92 3.28 1.28-6.53-4.86-4.5 6.6-.83L12 2.5Z" />
    </svg>
  );
}

/** Resultado da música: pontuação + transição automática para a próxima. */
export function ResultsView({
  jam,
  songsById,
  secondsToNext,
}: {
  jam: Jam;
  songsById: Map<string, Song>;
  secondsToNext: number | null;
}) {
  const result = jam.lastResult;
  if (!result) return null;

  const singer = jam.participants.find((p) => p.id === result.participantId);
  const song = songsById.get(result.songId);
  const stars = Math.round((result.score / 1000) * 5);

  return (
    <main
      className="grid h-full grid-cols-[1.3fr_1fr] gap-12 p-16"
      style={{
        background:
          "radial-gradient(80% 70% at 50% 0%, rgba(124,58,237,0.3), transparent 60%), #09090B",
      }}
    >
      <section className="flex flex-col items-center justify-center gap-6 text-center">
        <Avatar
          name={singer?.name}
          size={96}
          style={
            singer ? { backgroundColor: `${singer.color}33`, color: singer.color } : undefined
          }
        />
        <div>
          <p className="text-title font-bold">{singer?.name ?? "—"}</p>
          <p className="mt-1 text-subtitle text-foreground-muted">{song?.title}</p>
        </div>

        <p className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-[10rem] font-extrabold leading-none text-transparent">
          {result.score}
        </p>

        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} filled={i < stars} />
          ))}
        </div>

        <p className="text-subtitle text-foreground-muted">
          {Math.round(result.accuracy * 100)}% de afinação ·{" "}
          {result.notesHit}/{result.notesTotal} notas
        </p>

        {secondsToNext !== null && (
          <p className="mt-4 text-body font-semibold uppercase tracking-wider text-foreground-muted">
            continuando em {secondsToNext}...
          </p>
        )}
      </section>

      <section className="flex flex-col justify-center">
        <LeaderboardPanel participants={jam.participants} />
      </section>
    </main>
  );
}
