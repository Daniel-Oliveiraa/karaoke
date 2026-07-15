"use client";

import type { Jam } from "@kantai/shared-types";
import { LeaderboardPanel } from "./LeaderboardPanel";

/** Encerramento: ranking final + resumo da sessão. */
export function EndedView({ jam }: { jam: Jam }) {
  const sung = jam.queue.filter((i) => i.status === "done").length;
  const durationMin = Math.max(1, Math.round((Date.now() - jam.createdAt) / 60000));
  const champion = [...jam.participants].sort((a, b) => b.totalScore - a.totalScore)[0];

  return (
    <main
      className="flex h-full flex-col items-center justify-center gap-10 p-16 text-center"
      style={{
        background:
          "radial-gradient(80% 70% at 50% 0%, rgba(124,58,237,0.3), transparent 60%), #09090B",
      }}
    >
      <div>
        <p className="text-subtitle font-semibold uppercase tracking-wider text-foreground-muted">
          Fim da Jam
        </p>
        {champion && champion.totalScore > 0 ? (
          <p className="mt-3 text-hero font-extrabold">
            🏆 {champion.name}
          </p>
        ) : (
          <p className="mt-3 text-hero font-extrabold">Obrigado por cantar!</p>
        )}
      </div>

      <div className="w-full max-w-xl">
        <LeaderboardPanel participants={jam.participants} />
      </div>

      <p className="text-subtitle text-foreground-muted">
        {sung} música{sung === 1 ? "" : "s"} cantada{sung === 1 ? "" : "s"} ·{" "}
        {durationMin} min de Jam · KAN<span className="text-primary">TAÍ</span>
      </p>
    </main>
  );
}
