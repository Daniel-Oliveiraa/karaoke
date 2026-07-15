"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@kantai/ui";
import type { Jam, Song } from "@kantai/shared-types";
import QRCode from "qrcode";
import { PARTICIPANT_URL } from "@/lib/socket";
import { LeaderboardPanel } from "./LeaderboardPanel";

function PeopleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h9v-2.5c0-1.09.55-2.03 1.36-2.77C10.5 13.29 9.11 13 8 13Zm8 0c-.29 0-.62.02-.97.06.98.83 1.6 1.9 1.6 3.06V19h6.37v-2.5c0-2.33-4.67-3.5-7-3.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Lobby / aguardando: código gigante + QR, participantes chegando em tempo
 * real e a fila. Também é o estado entre músicas ("fila vazia" quando não
 * há próxima música). Layout desenhado a partir de docs/jam-layout.png.
 */
export function LobbyView({
  jam,
  songsById,
  countdown,
}: {
  jam: Jam;
  songsById: Map<string, Song>;
  countdown: number | null;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const joinUrl = `${PARTICIPANT_URL}/?code=${jam.code}`;

  useEffect(() => {
    QRCode.toDataURL(joinUrl, {
      width: 360,
      margin: 1,
      color: { dark: "#09090B", light: "#FFFFFF" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [joinUrl]);

  const queued = jam.queue.filter((i) => i.status === "queued");
  const next = queued[0];
  const nextSong = next ? songsById.get(next.songId) : undefined;
  const showingNext = countdown !== null && Boolean(nextSong) && Boolean(next);

  /** Nomes de quem canta o item ("Ana & Bia"), sem os que recusaram. */
  const singerNames = (item: (typeof queued)[number]) =>
    item.singers
      .filter((s) => s.status !== "declined")
      .map(
        (s) => jam.participants.find((p) => p.id === s.participantId)?.name ?? "?"
      )
      .join(" & ");

  return (
    <main
      className="flex h-full flex-col p-16"
      style={{
        background:
          "radial-gradient(90% 55% at 50% 0%, rgba(124,58,237,0.25), transparent 60%), #09090B",
      }}
    >
      {/* header */}
      <header className="text-center">
        <p className="text-2xl font-extrabold tracking-tight">
          KAN<span className="text-primary">TAÍ</span>
        </p>
        <p className="mt-1 text-caption text-foreground-muted">Aumenta o som e Kantaí.</p>
      </header>

      {/* conteúdo: grid de duas colunas ocupando o espaço restante */}
      <div className="grid flex-1 grid-cols-[1.2fr_1fr] items-center gap-12 py-10">
        {/* Coluna esquerda: entrada na Jam — tudo centralizado no painel */}
        <section className="flex flex-col items-center justify-center gap-9 text-center">
          <div>
            <p className="text-title font-bold">
              Sua Jam <span className="text-primary">está aberta!</span>
            </p>
            <p className="mt-2 text-subtitle text-foreground-muted">
              Convide a galera e comece quando estiver pronto.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3">
            <p className="text-caption font-semibold uppercase tracking-[0.2em] text-primary">
              Entre na Jam
            </p>
            {qr && (
              <div className="rounded-lg bg-white p-4 shadow-[0_0_50px_rgba(124,58,237,0.35)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  alt={`QR Code para entrar na Jam ${jam.code}`}
                  className="h-44 w-44"
                />
              </div>
            )}
          </div>

          <div className="w-full max-w-sm">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-caption text-foreground-muted">
                ou use o código
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <p className="mt-3 text-center text-[6rem] font-extrabold leading-none tracking-[0.25em] text-foreground">
              {jam.code}
            </p>
          </div>
        </section>

        {/* Coluna direita: quem chegou + fila + ranking */}
        <section className="flex min-h-0 flex-col justify-center gap-8">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-body font-semibold uppercase tracking-wider text-primary">
                Participantes
              </p>
              <p className="text-caption text-foreground-muted">
                {jam.participants.length} conectado{jam.participants.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              {jam.participants.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3"
                >
                  <Avatar
                    name={p.name}
                    size={36}
                    style={{ backgroundColor: `${p.color}33`, color: p.color }}
                  />
                  <span className="text-body font-semibold">{p.name}</span>
                </div>
              ))}
              {jam.participants.length === 0 && (
                <p className="text-body text-foreground-muted">
                  Ninguém ainda — seja o primeiro!
                </p>
              )}
            </div>
          </div>

          {queued.length > 0 && (
            <div>
              <p className="mb-4 text-body font-semibold uppercase tracking-wider text-foreground-muted">
                Fila · {queued.length}
              </p>
              <div className="flex flex-col gap-2">
                {queued.slice(0, 4).map((item, i) => {
                  const song = songsById.get(item.songId);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-4 rounded-md border border-border bg-surface px-5 py-3"
                    >
                      <span className="text-body font-bold text-foreground-muted">{i + 1}</span>
                      <span className="flex-1 truncate text-subtitle font-semibold">
                        {song?.title ?? "?"}
                      </span>
                      <span className="text-body text-foreground-muted">{singerNames(item)}</span>
                    </div>
                  );
                })}
                {queued.length > 4 && (
                  <p className="text-body text-foreground-muted">+{queued.length - 4} na fila</p>
                )}
              </div>
            </div>
          )}

          {jam.participants.some((p) => p.totalScore > 0) && (
            <LeaderboardPanel participants={jam.participants} compact />
          )}
        </section>
      </div>

      {/* rodapé: status da Jam (escondido quando o popup "A seguir" já comunica isso) */}
      {!showingNext && (
        <footer className="flex items-center justify-center gap-2.5 text-subtitle text-foreground-muted">
          <PeopleIcon className="h-6 w-6 text-primary" />
          {jam.participants.length === 0
            ? "Aguardando mais pessoas..."
            : "Adicionem músicas à fila pelo celular para começar! 🎤"}
        </footer>
      )}

      {/* popup "A seguir": centralizado na tela inteira, não só na coluna */}
      {showingNext && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-glass">
          <div className="rounded-lg border border-primary/40 bg-primary/10 px-12 py-10 text-center shadow-[0_0_60px_rgba(124,58,237,0.35)]">
            <p className="text-body text-foreground-muted">A seguir</p>
            <p className="mt-1 text-title font-bold">
              {nextSong!.title}
              <span className="font-medium text-foreground-muted"> · {singerNames(next!)}</span>
            </p>
            <p className="mt-2 text-subtitle font-semibold text-primary">
              Começando em {countdown}...
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
