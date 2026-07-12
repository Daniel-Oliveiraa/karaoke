"use client";

import { useMemo, useState } from "react";
import { Avatar, Badge, Button } from "@jamroom/ui";
import type { Jam, Participant, Song } from "@jamroom/shared-types";
import { getSocket } from "@/lib/socket";

/**
 * Hub do participante durante a Jam: fila, ranking e o botão principal
 * fixo de adicionar música (padrão mobile do design system).
 */
export function HubView({
  jam,
  me,
  songs,
}: {
  jam: Jam;
  me: Participant;
  songs: Song[];
}) {
  const [tab, setTab] = useState<"queue" | "ranking">("queue");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addedFlash, setAddedFlash] = useState<string | null>(null);

  const ranked = useMemo(
    () => [...jam.participants].sort((a, b) => b.totalScore - a.totalScore),
    [jam.participants]
  );
  const myRank = ranked.findIndex((p) => p.id === me.id) + 1;

  const visibleQueue = jam.queue.filter((i) => i.status !== "done");
  const songsById = useMemo(() => new Map(songs.map((s) => [s.id, s] as const)), [songs]);

  const filteredSongs = songs.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.title.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q) ||
      s.genre.toLowerCase().includes(q)
    );
  });

  function addSong(songId: string) {
    getSocket().emit("participant:add_song", songId);
    setSheetOpen(false);
    setSearch("");
    const title = songsById.get(songId)?.title ?? "Música";
    setAddedFlash(`${title} entrou na fila!`);
    setTimeout(() => setAddedFlash(null), 2500);
  }

  return (
    <main className="flex min-h-dvh flex-col pb-28">
      {/* header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 px-5 py-4 backdrop-blur-glass">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-caption text-foreground-muted">Jam</p>
            <p className="text-2xl font-extrabold tracking-widest">{jam.code}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-caption text-foreground-muted">{me.name}</p>
              <p className="text-body font-bold">
                {myRank > 0 ? `#${myRank}` : "—"}
                <span className="ml-1.5 text-caption font-medium text-foreground-muted">
                  {me.totalScore} pts
                </span>
              </p>
            </div>
            <Avatar
              name={me.name}
              size={40}
              style={{ backgroundColor: `${me.color}33`, color: me.color }}
            />
          </div>
        </div>

        {/* tabs */}
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-md bg-surface p-1">
          {(
            [
              ["queue", `Fila · ${visibleQueue.length}`],
              ["ranking", "Ranking"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-[12px] py-2 text-caption font-semibold transition-colors ${
                tab === key
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* conteúdo */}
      <section className="flex-1 px-5 py-4">
        {tab === "queue" ? (
          visibleQueue.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-4xl">🎤</p>
              <p className="text-body font-semibold">A fila está vazia</p>
              <p className="max-w-[240px] text-caption text-foreground-muted">
                Adicione a primeira música e abra a noite!
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {visibleQueue.map((item, i) => {
                const song = songsById.get(item.songId);
                const singer = jam.participants.find((p) => p.id === item.participantId);
                const mine = item.participantId === me.id;
                return (
                  <li
                    key={item.id}
                    className={`flex items-center gap-3 rounded-md border bg-surface p-3.5 ${
                      mine ? "border-primary/50" : "border-border"
                    }`}
                  >
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] text-lg font-bold text-white/90"
                      style={{
                        background: song
                          ? `linear-gradient(135deg, ${song.coverColors[0]}, ${song.coverColors[1]})`
                          : "#202024",
                      }}
                    >
                      ♪
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-semibold">{song?.title ?? "?"}</p>
                      <p className="truncate text-caption text-foreground-muted">
                        {singer?.name}
                        {mine && " (você)"}
                      </p>
                    </div>
                    {item.status === "playing" ? (
                      <Badge variant="success">tocando</Badge>
                    ) : (
                      <span className="text-caption font-bold text-foreground-muted">
                        #{i + (visibleQueue.some((q) => q.status === "playing") ? 0 : 1)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        ) : (
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
                    i === 0
                      ? "bg-warning/20 text-warning"
                      : "bg-surface-elevated text-foreground-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <Avatar
                  name={p.name}
                  size={36}
                  style={{ backgroundColor: `${p.color}33`, color: p.color }}
                />
                <span className="min-w-0 flex-1 truncate text-body font-semibold">
                  {p.name}
                  {p.id === me.id && (
                    <span className="text-foreground-muted"> (você)</span>
                  )}
                </span>
                <span className="text-body font-bold text-foreground-muted">
                  {p.totalScore} pts
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* toast simples */}
      {addedFlash && (
        <div className="fixed inset-x-5 bottom-24 z-30 rounded-md border border-success/40 bg-success/15 px-4 py-3 text-center text-caption font-semibold text-success backdrop-blur-glass">
          {addedFlash}
        </div>
      )}

      {/* botão principal fixo */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/90 px-5 py-4 backdrop-blur-glass">
        <Button
          variant="primary"
          className="w-full justify-center py-4 text-body font-semibold"
          onClick={() => setSheetOpen(true)}
        >
          + Adicionar música
        </Button>
      </div>

      {/* sheet de busca/adição */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <button
            type="button"
            aria-label="Fechar"
            className="absolute inset-0 bg-black/60"
            onClick={() => setSheetOpen(false)}
          />
          <div className="relative max-h-[80dvh] overflow-hidden rounded-t-lg border-t border-border bg-background-secondary">
            <div className="border-b border-border p-5">
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por título, artista ou gênero"
                className="min-h-input w-full rounded-sm border border-border bg-surface px-4 text-body placeholder:text-foreground-muted/40 focus:border-primary focus:outline-none"
              />
            </div>
            <ul className="max-h-[55dvh] overflow-y-auto p-5 pt-3">
              {filteredSongs.map((song) => (
                <li key={song.id} className="flex items-center gap-3 py-2.5">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] text-lg font-bold text-white/90"
                    style={{
                      background: `linear-gradient(135deg, ${song.coverColors[0]}, ${song.coverColors[1]})`,
                    }}
                  >
                    ♪
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-semibold">{song.title}</p>
                    <p className="truncate text-caption text-foreground-muted">
                      {song.artist} · {Math.round(song.durationSec)}s
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    className="px-4 py-2 text-caption"
                    onClick={() => addSong(song.id)}
                  >
                    Adicionar
                  </Button>
                </li>
              ))}
              {filteredSongs.length === 0 && (
                <p className="py-8 text-center text-caption text-foreground-muted">
                  Nada encontrado para “{search}”.
                </p>
              )}
            </ul>
          </div>
        </div>
      )}
    </main>
  );
}
