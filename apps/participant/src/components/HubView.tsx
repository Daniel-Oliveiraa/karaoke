"use client";

import { useMemo, useState } from "react";
import { Avatar, Badge, Button } from "@jamroom/ui";
import type { Jam, Participant, Song } from "@jamroom/shared-types";
import { MAX_SINGERS_PER_ITEM } from "@jamroom/shared-types";
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
  /** Item da fila cujo sheet "convidar para cantar junto" está aberto. */
  const [inviteItemId, setInviteItemId] = useState<string | null>(null);

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

  const participantsById = useMemo(
    () => new Map(jam.participants.map((p) => [p.id, p] as const)),
    [jam.participants]
  );

  /** Convites de dueto esperando a minha resposta. */
  const myInvites = jam.queue.filter(
    (i) =>
      i.status === "queued" &&
      i.singers.some((s) => s.participantId === me.id && s.status === "invited")
  );

  const inviteItem = inviteItemId
    ? jam.queue.find(
        (i) => i.id === inviteItemId && i.status === "queued" && i.participantId === me.id
      ) ?? null
    : null;

  /** Nomes de quem canta o item ("Ana + Bia"), com pendentes marcados. */
  function singersLabel(item: Jam["queue"][number]): string {
    const parts = item.singers
      .filter((s) => s.status !== "declined")
      .map((s) => {
        const name =
          s.participantId === me.id
            ? "você"
            : participantsById.get(s.participantId)?.name ?? "?";
        return s.status === "invited" ? `${name}?` : name;
      });
    return parts.join(" + ");
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
                const mine = item.participantId === me.id;
                const activeSingers = item.singers.filter(
                  (s) => s.status !== "declined"
                ).length;
                const canInvite =
                  mine &&
                  item.status === "queued" &&
                  activeSingers < MAX_SINGERS_PER_ITEM &&
                  jam.participants.length > 1;
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
                        {singersLabel(item)}
                      </p>
                    </div>
                    {item.status === "playing" ? (
                      <Badge variant="success">tocando</Badge>
                    ) : (
                      <span className="text-caption font-bold text-foreground-muted">
                        #{i + (visibleQueue.some((q) => q.status === "playing") ? 0 : 1)}
                      </span>
                    )}
                    {canInvite && (
                      <button
                        type="button"
                        aria-label={`Convidar alguém para cantar ${song?.title ?? "esta música"} junto`}
                        onClick={() => setInviteItemId(item.id)}
                        className="flex h-8 shrink-0 items-center justify-center rounded-full bg-primary/15 px-2.5 text-caption font-semibold text-primary-hover transition-colors hover:bg-primary/25"
                      >
                        + dueto
                      </button>
                    )}
                    {mine && item.status === "queued" && (
                      <button
                        type="button"
                        aria-label={`Remover ${song?.title ?? "música"} da fila`}
                        onClick={() =>
                          getSocket().emit("participant:remove_song", item.id)
                        }
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-error/15 hover:text-error"
                      >
                        ✕
                      </button>
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
        <div className="fixed inset-x-5 bottom-40 z-30 rounded-md border border-success/40 bg-success/15 px-4 py-3 text-center text-caption font-semibold text-success backdrop-blur-glass">
          {addedFlash}
        </div>
      )}

      {/* convite de dueto esperando resposta */}
      {myInvites[0] && (
        <div className="fixed inset-x-5 bottom-24 z-30 rounded-md border border-primary/50 bg-surface-elevated/95 p-4 backdrop-blur-glass">
          <p className="text-caption text-foreground-muted">Convite para dueto</p>
          <p className="mt-0.5 text-body font-semibold">
            {participantsById.get(myInvites[0].participantId)?.name ?? "Alguém"} te
            chamou para cantar{" "}
            <span className="text-primary-hover">
              {songsById.get(myInvites[0].songId)?.title ?? "uma música"}
            </span>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              className="justify-center py-2.5 text-caption font-semibold"
              onClick={() =>
                getSocket().emit("participant:invite_response", {
                  queueItemId: myInvites[0]!.id,
                  accept: true,
                })
              }
            >
              Aceitar
            </Button>
            <Button
              variant="ghost"
              className="justify-center py-2.5 text-caption font-semibold"
              onClick={() =>
                getSocket().emit("participant:invite_response", {
                  queueItemId: myInvites[0]!.id,
                  accept: false,
                })
              }
            >
              Recusar
            </Button>
          </div>
          {myInvites.length > 1 && (
            <p className="mt-2 text-center text-caption text-foreground-muted">
              +{myInvites.length - 1} outro(s) convite(s) na fila
            </p>
          )}
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

      {/* sheet de convite para dueto */}
      {inviteItem && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <button
            type="button"
            aria-label="Fechar"
            className="absolute inset-0 bg-black/60"
            onClick={() => setInviteItemId(null)}
          />
          <div className="relative max-h-[80dvh] overflow-hidden rounded-t-lg border-t border-border bg-background-secondary">
            <div className="border-b border-border p-5">
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border" />
              <p className="text-body font-semibold">
                Cantar {songsById.get(inviteItem.songId)?.title ?? "esta música"} com...
              </p>
              <p className="mt-1 text-caption text-foreground-muted">
                Quem aceitar canta junto no próprio celular e ganha a própria
                pontuação.
              </p>
            </div>
            <ul className="max-h-[55dvh] overflow-y-auto p-5 pt-3">
              {jam.participants
                .filter((p) => p.id !== me.id)
                .map((p) => {
                  const singer = inviteItem.singers.find(
                    (s) => s.participantId === p.id
                  );
                  const full =
                    inviteItem.singers.filter((s) => s.status !== "declined")
                      .length >= MAX_SINGERS_PER_ITEM;
                  return (
                    <li key={p.id} className="flex items-center gap-3 py-2.5">
                      <Avatar
                        name={p.name}
                        size={40}
                        style={{ backgroundColor: `${p.color}33`, color: p.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-semibold">{p.name}</p>
                        <p className="text-caption text-foreground-muted">
                          {p.connected ? "na Jam agora" : "desconectado"}
                        </p>
                      </div>
                      {singer?.status === "accepted" ? (
                        <Badge variant="success">confirmou</Badge>
                      ) : singer?.status === "invited" ? (
                        <Badge>aguardando...</Badge>
                      ) : (
                        <Button
                          variant="secondary"
                          className="px-4 py-2 text-caption"
                          disabled={full}
                          onClick={() =>
                            getSocket().emit("participant:invite", {
                              queueItemId: inviteItem.id,
                              inviteeId: p.id,
                            })
                          }
                        >
                          {singer?.status === "declined"
                            ? "Convidar de novo"
                            : "Convidar"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              {jam.participants.length <= 1 && (
                <p className="py-8 text-center text-caption text-foreground-muted">
                  Ninguém mais na Jam ainda — compartilhe o código!
                </p>
              )}
            </ul>
          </div>
        </div>
      )}
    </main>
  );
}
