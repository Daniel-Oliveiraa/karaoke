"use client";

import { Avatar } from "@jamroom/ui";
import type { Participant } from "@jamroom/shared-types";

/** Ranking ao vivo — painel lateral da tela host (glass, blur pequeno). */
export function LeaderboardPanel({
  participants,
  compact = false,
}: {
  participants: Participant[];
  compact?: boolean;
}) {
  const ranked = [...participants].sort((a, b) => b.totalScore - a.totalScore);

  if (ranked.length === 0) return null;

  return (
    <div className="w-full rounded-lg border border-white/10 bg-background/70 p-6 backdrop-blur-glass">
      <p className="mb-4 text-body font-semibold uppercase tracking-wider text-foreground-muted">
        Ranking da Jam
      </p>
      <div className="flex flex-col divide-y divide-border/60">
        {ranked.slice(0, compact ? 5 : 8).map((p, i) => (
          <div key={p.id} className="flex items-center gap-4 py-3">
            <span
              className={
                i === 0
                  ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/20 text-lg font-bold text-warning"
                  : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-lg font-semibold text-foreground-muted"
              }
            >
              {i + 1}
            </span>
            <Avatar
              name={p.name}
              size={36}
              style={{ backgroundColor: `${p.color}33`, color: p.color }}
            />
            <span className="flex-1 truncate text-subtitle font-semibold">
              {p.name}
              {!p.connected && (
                <span className="ml-2 text-caption text-foreground-muted">
                  (saiu)
                </span>
              )}
            </span>
            <span className="text-subtitle font-bold text-foreground-muted">
              {p.totalScore}
              <span className="ml-1 text-caption font-medium">pts</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
