"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar, Badge, Button, ProgressBar } from "@jamroom/ui";
import type {
  ImportJob,
  Jam,
  Participant,
  Song,
  YoutubeResult,
} from "@jamroom/shared-types";
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
  /** Música escolhida no catálogo, aguardando o popup "chamar alguém?". */
  const [inviteSongId, setInviteSongId] = useState<string | null>(null);
  const [selectedInvitees, setSelectedInvitees] = useState<string[]>([]);
  /** Aba do catálogo: "top" (mais tocadas), "all", "other" ou "g:<gênero>". */
  const [catalogTab, setCatalogTab] = useState("top");
  /** Resultados da busca no YouTube (null = modo catálogo normal). */
  const [ytResults, setYtResults] = useState<YoutubeResult[] | null>(null);
  const [ytSearching, setYtSearching] = useState(false);
  /** Importações em andamento (alimentado por catalog:import_update). */
  const [importJobs, setImportJobs] = useState<Map<string, ImportJob>>(new Map());

  useEffect(() => {
    const socket = getSocket();
    const onImportUpdate = (job: ImportJob) => {
      setImportJobs((prev) => {
        const next = new Map(prev);
        if (job.status === "queued" || job.status === "processing") {
          next.set(job.id, job);
        } else {
          next.delete(job.id);
        }
        return next;
      });
      if (job.status === "done") {
        setAddedFlash(`${job.title} entrou no catálogo!`);
        setTimeout(() => setAddedFlash(null), 3500);
      } else if (job.status === "failed") {
        setAddedFlash(`Falhou a importação de ${job.title}`);
        setTimeout(() => setAddedFlash(null), 3500);
      }
    };
    socket.on("catalog:import_update", onImportUpdate);
    return () => {
      socket.off("catalog:import_update", onImportUpdate);
    };
  }, []);

  const ranked = useMemo(
    () => [...jam.participants].sort((a, b) => b.totalScore - a.totalScore),
    [jam.participants]
  );
  const myRank = ranked.findIndex((p) => p.id === me.id) + 1;

  const visibleQueue = jam.queue.filter((i) => i.status !== "done");
  const songsById = useMemo(() => new Map(songs.map((s) => [s.id, s] as const)), [songs]);

  /** Gêneros com ≥2 músicas viram aba própria; o resto cai em "Outras". */
  const genreCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of songs) counts.set(s.genre, (counts.get(s.genre) ?? 0) + 1);
    return counts;
  }, [songs]);

  const catalogTabs = useMemo(() => {
    const genres = [...genreCounts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([g]) => ({ id: `g:${g}`, label: g }));
    const tabs = [
      { id: "top", label: "Mais tocadas" },
      { id: "all", label: "Todas" },
      ...genres,
    ];
    if ([...genreCounts.values()].some((n) => n < 2)) {
      tabs.push({ id: "other", label: "Outras" });
    }
    return tabs;
  }, [genreCounts]);

  const query = search.trim().toLowerCase();
  const filteredSongs = useMemo(() => {
    // busca com texto varre o catálogo inteiro, ignorando a aba
    if (query) {
      return songs.filter(
        (s) =>
          s.title.toLowerCase().includes(query) ||
          s.artist.toLowerCase().includes(query) ||
          s.genre.toLowerCase().includes(query)
      );
    }
    if (catalogTab === "top") {
      return [...songs]
        .sort(
          (a, b) =>
            (b.playCount ?? 0) - (a.playCount ?? 0) ||
            a.title.localeCompare(b.title)
        )
        .slice(0, 30);
    }
    if (catalogTab === "all") return songs;
    if (catalogTab === "other") {
      return songs.filter((s) => (genreCounts.get(s.genre) ?? 0) < 2);
    }
    const genre = catalogTab.slice(2); // "g:<gênero>"
    return songs.filter((s) => s.genre === genre);
  }, [songs, query, catalogTab, genreCounts]);

  /** Tap em "Adicionar" no catálogo: sozinho na Jam adiciona direto; com
   *  mais gente, abre o popup "chamar alguém para cantar junto?". */
  function pickSong(songId: string) {
    setSheetOpen(false);
    setSearch("");
    if (jam.participants.length <= 1) {
      confirmAdd(songId, []);
    } else {
      setSelectedInvitees([]);
      setInviteSongId(songId);
    }
  }

  function confirmAdd(songId: string, inviteeIds: string[]) {
    getSocket().emit("participant:add_song", { songId, inviteeIds });
    setInviteSongId(null);
    const title = songsById.get(songId)?.title ?? "Música";
    setAddedFlash(
      inviteeIds.length > 0
        ? `Convite enviado — ${title} entra na fila quando alguém aceitar`
        : `${title} entrou na fila!`
    );
    setTimeout(() => setAddedFlash(null), 3000);
  }

  function searchYoutube() {
    if (query.length < 2 || ytSearching) return;
    setYtSearching(true);
    getSocket().emit("catalog:search_youtube", search.trim(), (results) => {
      setYtResults(results);
      setYtSearching(false);
    });
  }

  function importFromYoutube(r: YoutubeResult) {
    getSocket().emit(
      "catalog:import_youtube",
      { videoId: r.videoId, title: r.title },
      (res) => {
        setAddedFlash(
          res.ok
            ? `Processando ${r.title} — entra no catálogo em alguns minutos`
            : res.error ?? "Não foi possível importar"
        );
        setTimeout(() => setAddedFlash(null), 3500);
        if (res.ok) setYtResults(null);
      }
    );
  }

  const fmtDuration = (sec: number) =>
    `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, "0")}`;

  const activeJobs = [...importJobs.values()];
  /** Meus próprios imports em andamento — mostrados num banner persistente
   *  fora do sheet, visível em qualquer aba (fila/ranking). */
  const myImportJobs = activeJobs.filter((j) => j.requesterId === me.id);

  function toggleInvitee(id: string) {
    setSelectedInvitees((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < MAX_SINGERS_PER_ITEM - 1
          ? [...prev, id]
          : prev
    );
  }

  const participantsById = useMemo(
    () => new Map(jam.participants.map((p) => [p.id, p] as const)),
    [jam.participants]
  );

  /** Convites de dueto esperando a minha resposta. */
  const myInvites = jam.queue.filter(
    (i) =>
      i.status === "inviting" &&
      i.singers.some((s) => s.participantId === me.id && s.status === "invited")
  );

  /** Meus itens em que todos recusaram: eu decido (solo ou cancelar). */
  const needsDecision = jam.queue.find(
    (i) =>
      i.status === "inviting" &&
      i.participantId === me.id &&
      !i.singers.some((s) => s.status === "invited") &&
      !i.singers.some(
        (s) => s.status === "accepted" && s.participantId !== me.id
      )
  );

  const inviteSong = inviteSongId ? songsById.get(inviteSongId) ?? null : null;

  /** Posição de reprodução (itens "inviting" não contam na fila). */
  const positions = new Map<string, number>();
  {
    const playable = visibleQueue.filter((i) => i.status !== "inviting");
    const offset = playable.some((i) => i.status === "playing") ? 0 : 1;
    playable.forEach((i, idx) => positions.set(i.id, idx + offset));
  }

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
              {visibleQueue.map((item) => {
                const song = songsById.get(item.songId);
                const mine = item.participantId === me.id;
                const inviting = item.status === "inviting";
                return (
                  <li
                    key={item.id}
                    className={`flex items-center gap-3 rounded-md border bg-surface p-3.5 ${
                      mine ? "border-primary/50" : "border-border"
                    } ${inviting ? "opacity-60" : ""}`}
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
                    ) : inviting ? (
                      <Badge>aguardando convite...</Badge>
                    ) : (
                      <span className="text-caption font-bold text-foreground-muted">
                        #{positions.get(item.id)}
                      </span>
                    )}
                    {mine && item.status !== "playing" && (
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

      {/* banners fixos: import em andamento + convite recebido + decisão do dono */}
      {(myImportJobs[0] || myInvites[0] || needsDecision) && (
        <div className="fixed inset-x-5 bottom-24 z-30 flex flex-col gap-2.5">
          {myImportJobs[0] && (
            <div className="rounded-md border border-primary/50 bg-surface-elevated/95 p-4 backdrop-blur-glass">
              <p className="text-caption text-foreground-muted">
                Importando do YouTube
              </p>
              <p className="mt-0.5 truncate text-body font-semibold">
                {myImportJobs[0].title}
              </p>
              <div className="mt-3">
                <ProgressBar
                  value={myImportJobs[0].progress / 100}
                  className={
                    myImportJobs[0].status === "processing" ? "animate-pulse" : undefined
                  }
                />
              </div>
              <p className="mt-1.5 text-caption text-foreground-muted">
                {myImportJobs[0].stage} · {myImportJobs[0].progress}%
              </p>
              {myImportJobs.length > 1 && (
                <p className="mt-1 text-caption text-foreground-muted">
                  +{myImportJobs.length - 1} outra(s) importação(ões) sua(s) na fila
                </p>
              )}
            </div>
          )}

          {myInvites[0] && (
            <div className="rounded-md border border-primary/50 bg-surface-elevated/95 p-4 backdrop-blur-glass">
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

          {needsDecision && (
            <div className="rounded-md border border-warning/50 bg-surface-elevated/95 p-4 backdrop-blur-glass">
              <p className="text-caption text-foreground-muted">Convite recusado</p>
              <p className="mt-0.5 text-body font-semibold">
                {needsDecision.singers
                  .filter((s) => s.status === "declined")
                  .map((s) => participantsById.get(s.participantId)?.name ?? "?")
                  .join(", ") || "Ninguém"}{" "}
                não topou cantar{" "}
                <span className="text-primary-hover">
                  {songsById.get(needsDecision.songId)?.title ?? "sua música"}
                </span>
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant="primary"
                  className="justify-center py-2.5 text-caption font-semibold"
                  onClick={() =>
                    getSocket().emit("participant:resolve_item", {
                      queueItemId: needsDecision.id,
                      addSolo: true,
                    })
                  }
                >
                  Cantar sozinho
                </Button>
                <Button
                  variant="ghost"
                  className="justify-center py-2.5 text-caption font-semibold"
                  onClick={() =>
                    getSocket().emit("participant:resolve_item", {
                      queueItemId: needsDecision.id,
                      addSolo: false,
                    })
                  }
                >
                  Cancelar música
                </Button>
              </div>
            </div>
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
            onClick={() => {
              setSheetOpen(false);
              setYtResults(null);
            }}
          />
          <div className="relative max-h-[85dvh] overflow-hidden rounded-t-lg border-t border-border bg-background-secondary">
            <div className="border-b border-border p-5 pb-3">
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por título, artista ou gênero"
                className="min-h-input w-full rounded-sm border border-border bg-surface px-4 text-body placeholder:text-foreground-muted/40 focus:border-primary focus:outline-none"
              />

              {/* importações em andamento */}
              {activeJobs.length > 0 && (
                <p className="mt-3 flex items-center gap-2 text-caption text-foreground-muted">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                  Importando: {activeJobs[0]!.title}
                  {activeJobs.length > 1 && ` · +${activeJobs.length - 1} na fila`}
                </p>
              )}

              {/* abas por gênero (a busca com texto varre tudo) */}
              {ytResults === null && !query && (
                <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
                  {catalogTabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setCatalogTab(t.id)}
                      className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-caption font-semibold transition-colors ${
                        catalogTab === t.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-surface text-foreground-muted"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {ytResults === null ? (
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
                        {song.artist} · {song.genre}
                        {catalogTab === "top" && (song.playCount ?? 0) > 0 && !query
                          ? ` · ${song.playCount}x cantada`
                          : ""}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      className="px-4 py-2 text-caption"
                      onClick={() => pickSong(song.id)}
                    >
                      Adicionar
                    </Button>
                  </li>
                ))}
                {filteredSongs.length === 0 && (
                  <p className="py-6 text-center text-caption text-foreground-muted">
                    Nada encontrado para “{search}” no catálogo.
                  </p>
                )}
                {query.length >= 2 && (
                  <li className="pt-2">
                    <Button
                      variant="secondary"
                      className="w-full justify-center py-3 text-caption font-semibold"
                      disabled={ytSearching}
                      onClick={searchYoutube}
                    >
                      {ytSearching
                        ? "Buscando no YouTube..."
                        : `▶ Buscar “${search.trim()}” no YouTube`}
                    </Button>
                  </li>
                )}
              </ul>
            ) : (
              <div className="max-h-[55dvh] overflow-y-auto p-5 pt-3">
                <button
                  type="button"
                  onClick={() => setYtResults(null)}
                  className="mb-2 text-caption font-semibold text-foreground-muted transition-colors hover:text-foreground"
                >
                  ← Voltar ao catálogo
                </button>
                <ul>
                  {ytResults.map((r) => (
                    <li key={r.videoId} className="flex items-center gap-3 py-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.thumbnailUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-[12px] object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-caption font-semibold leading-snug">
                          {r.title}
                        </p>
                        <p className="truncate text-caption text-foreground-muted">
                          {r.channel}
                          {r.durationSec > 0 && ` · ${fmtDuration(r.durationSec)}`}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        className="shrink-0 px-3 py-2 text-caption"
                        onClick={() => importFromYoutube(r)}
                      >
                        + Catálogo
                      </Button>
                    </li>
                  ))}
                  {ytResults.length === 0 && (
                    <p className="py-8 text-center text-caption text-foreground-muted">
                      Nada encontrado no YouTube.
                    </p>
                  )}
                </ul>
                <p className="mt-3 text-center text-caption text-foreground-muted/70">
                  Baixe a versão original com voz — o sistema remove o vocal e
                  sincroniza a letra (~5 min). Para uso pessoal; músicas
                  comerciais não são licenciadas.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* popup pós-catálogo: chamar alguém para cantar junto? */}
      {inviteSongId && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <button
            type="button"
            aria-label="Fechar"
            className="absolute inset-0 bg-black/60"
            onClick={() => setInviteSongId(null)}
          />
          <div className="relative max-h-[80dvh] overflow-hidden rounded-t-lg border-t border-border bg-background-secondary">
            <div className="border-b border-border p-5">
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border" />
              <p className="text-body font-semibold">
                Chamar alguém para cantar{" "}
                {inviteSong?.title ?? "esta música"} junto?
              </p>
              <p className="mt-1 text-caption text-foreground-muted">
                A música entra na fila quando alguém aceitar (ou na hora, se
                for sozinho). Cada um canta no próprio celular e tem a própria
                pontuação.
              </p>
            </div>
            <ul className="max-h-[45dvh] overflow-y-auto p-5 pt-3">
              {jam.participants
                .filter((p) => p.id !== me.id)
                .map((p) => {
                  const selected = selectedInvitees.includes(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => toggleInvitee(p.id)}
                        className={`flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-colors ${
                          selected
                            ? "border-primary/60 bg-primary/10"
                            : "border-transparent"
                        }`}
                      >
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
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-caption font-bold ${
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ul>
            <div className="border-t border-border p-5">
              <Button
                variant="primary"
                className="w-full justify-center py-3.5 text-body font-semibold"
                onClick={() => confirmAdd(inviteSongId, selectedInvitees)}
              >
                {selectedInvitees.length > 0
                  ? `Convidar e adicionar (${selectedInvitees.length})`
                  : "Cantar sozinho"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
