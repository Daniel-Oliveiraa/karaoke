"use client";

import type { Jam, Participant, ScoreResult, Song } from "@jamroom/shared-types";

/** Resultado da própria performance, logo após cantar. */
export function MyResultView({
  jam,
  me,
  result,
  song,
}: {
  jam: Jam;
  me: Participant;
  result: ScoreResult;
  song: Song | undefined;
}) {
  const ranked = [...jam.participants].sort((a, b) => b.totalScore - a.totalScore);
  const myRank = ranked.findIndex((p) => p.id === me.id) + 1;
  const stars = Math.round((result.score / 1000) * 5);

  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center"
      style={{
        background:
          "radial-gradient(90% 60% at 50% 0%, rgba(124,58,237,0.3), transparent 60%), #09090B",
      }}
    >
      <div>
        <p className="text-caption font-semibold uppercase tracking-wider text-foreground-muted">
          {song?.title}
        </p>
        <p className="mt-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-8xl font-extrabold leading-none text-transparent">
          {result.score}
        </p>
        <p className="mt-3 text-2xl">
          {"★".repeat(stars)}
          <span className="text-foreground-muted/40">{"★".repeat(5 - stars)}</span>
        </p>
      </div>

      <p className="text-body text-foreground-muted">
        {Math.round(result.accuracy * 100)}% de afinação · {result.notesHit}/
        {result.notesTotal} notas
      </p>

      {/* dueto/grupo: pontuação dos parceiros lado a lado */}
      {jam.lastResults.length > 1 && (
        <div className="flex flex-wrap items-stretch justify-center gap-2.5">
          {jam.lastResults
            .filter((r) => r.participantId !== me.id)
            .map((r) => {
              const partner = jam.participants.find(
                (p) => p.id === r.participantId
              );
              return (
                <div
                  key={r.participantId}
                  className="rounded-md border border-border bg-surface px-5 py-3"
                >
                  <p className="max-w-28 truncate text-caption text-foreground-muted">
                    {partner?.name ?? "?"}
                  </p>
                  <p className="text-body font-bold">{r.score}</p>
                </div>
              );
            })}
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface px-8 py-5">
        <p className="text-caption text-foreground-muted">Sua posição na Jam</p>
        <p className="text-title font-extrabold">#{myRank}</p>
        <p className="text-caption text-foreground-muted">{me.totalScore} pts no total</p>
      </div>

      <p className="text-caption text-foreground-muted">
        A próxima música começa em instantes na TV...
      </p>
    </main>
  );
}
