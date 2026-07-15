"use client";

import { Avatar } from "@kantai/ui";
import type { Jam, Participant } from "@kantai/shared-types";

/** Encerramento do lado do participante: ranking final + agradecimento. */
export function JamEndedView({ jam, me }: { jam: Jam; me: Participant }) {
  const ranked = [...jam.participants].sort((a, b) => b.totalScore - a.totalScore);

  return (
    <main className="flex min-h-dvh flex-col gap-8 px-6 py-10">
      <header className="text-center">
        <p className="text-caption font-semibold uppercase tracking-wider text-foreground-muted">
          Fim da Jam
        </p>
        <p className="mt-2 text-title font-extrabold">Obrigado por cantar! 🎤</p>
      </header>

      <ul className="flex flex-col gap-2.5">
        {ranked.map((p, i) => (
          <li
            key={p.id}
            className={`flex items-center gap-3 rounded-md border bg-surface p-3.5 ${
              p.id === me.id ? "border-primary/50" : "border-border"
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-caption font-bold ${
                i === 0 ? "bg-warning/20 text-warning" : "bg-surface-elevated text-foreground-muted"
              }`}
            >
              {i === 0 ? "🏆" : i + 1}
            </span>
            <Avatar
              name={p.name}
              size={36}
              style={{ backgroundColor: `${p.color}33`, color: p.color }}
            />
            <span className="min-w-0 flex-1 truncate text-body font-semibold">
              {p.name}
              {p.id === me.id && <span className="text-foreground-muted"> (você)</span>}
            </span>
            <span className="text-body font-bold text-foreground-muted">
              {p.totalScore} pts
            </span>
          </li>
        ))}
      </ul>

      <p className="text-center text-caption text-foreground-muted">
        Gostou? Crie a sua própria Jam em{" "}
        <span className="font-semibold text-primary">kantai.online</span>
      </p>
    </main>
  );
}
