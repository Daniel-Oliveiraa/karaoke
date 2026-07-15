"use client";

import { Avatar, Badge } from "@kantai/ui";
import type { Jam, Song } from "@kantai/shared-types";
import { LeaderboardPanel } from "./LeaderboardPanel";

function Star({ filled, size }: { filled: boolean; size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size }}
      className={filled ? "text-warning" : "text-surface-elevated"}
      fill="currentColor"
    >
      <path d="M12 2.5l2.9 6.06 6.6.83-4.86 4.5 1.28 6.53L12 17.14l-5.92 3.28 1.28-6.53-4.86-4.5 6.6-.83L12 2.5Z" />
    </svg>
  );
}

/**
 * Resultado da música: pontuação + transição automática para a próxima.
 * Duetos/grupos: um cartão por cantor, lado a lado (lastResults já vem
 * ordenado por score desc — o primeiro é o melhor da música).
 */
export function ResultsView({
  jam,
  songsById,
  secondsToNext,
}: {
  jam: Jam;
  songsById: Map<string, Song>;
  secondsToNext: number | null;
}) {
  const results = jam.lastResults;
  if (results.length === 0) return null;

  const song = songsById.get(results[0]!.songId);
  const solo = results.length === 1;
  const scoreClass = solo
    ? "text-[10rem]"
    : results.length === 2
      ? "text-[6rem]"
      : "text-[4.5rem]";

  return (
    <main
      className="grid h-full grid-cols-[1.3fr_1fr] gap-12 p-16"
      style={{
        background:
          "radial-gradient(80% 70% at 50% 0%, rgba(124,58,237,0.3), transparent 60%), #09090B",
      }}
    >
      <section className="flex flex-col items-center justify-center gap-8 text-center">
        <p className="text-subtitle text-foreground-muted">{song?.title}</p>

        <div className="flex flex-wrap items-start justify-center gap-x-14 gap-y-8">
          {results.map((result, idx) => {
            const singer = jam.participants.find(
              (p) => p.id === result.participantId
            );
            const stars = Math.round((result.score / 1000) * 5);
            return (
              <div
                key={result.participantId}
                className="flex flex-col items-center gap-4"
              >
                <Avatar
                  name={singer?.name}
                  size={solo ? 96 : 64}
                  style={
                    singer
                      ? { backgroundColor: `${singer.color}33`, color: singer.color }
                      : undefined
                  }
                />
                <div className="flex items-center gap-3">
                  <p className={`font-bold ${solo ? "text-title" : "text-subtitle"}`}>
                    {singer?.name ?? "—"}
                  </p>
                  {!solo && idx === 0 && (
                    <Badge variant="success">melhor da música</Badge>
                  )}
                </div>

                <p
                  className={`bg-gradient-to-r from-primary to-secondary bg-clip-text font-extrabold leading-none text-transparent ${scoreClass}`}
                >
                  {result.score}
                </p>

                <div className="flex gap-1.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} filled={i < stars} size={solo ? 48 : 28} />
                  ))}
                </div>

                <p
                  className={
                    solo
                      ? "text-subtitle text-foreground-muted"
                      : "text-body text-foreground-muted"
                  }
                >
                  {Math.round(result.accuracy * 100)}% de afinação ·{" "}
                  {result.notesHit}/{result.notesTotal} notas
                </p>
              </div>
            );
          })}
        </div>

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
