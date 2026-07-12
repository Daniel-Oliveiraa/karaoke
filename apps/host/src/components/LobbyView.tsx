"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@jamroom/ui";
import type { Jam, Song } from "@jamroom/shared-types";
import QRCode from "qrcode";
import { PARTICIPANT_URL } from "@/lib/socket";
import { LeaderboardPanel } from "./LeaderboardPanel";

/**
 * Lobby / aguardando: código gigante + QR, participantes chegando em tempo
 * real e a fila. Também é o estado entre músicas ("fila vazia" quando não
 * há próxima música).
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
  const nextSinger = next
    ? jam.participants.find((p) => p.id === next.participantId)
    : undefined;

  return (
    <main className="grid h-full grid-cols-[1.2fr_1fr] gap-12 p-16">
      {/* Coluna esquerda: entrada na Jam */}
      <section className="flex flex-col items-start justify-center gap-10">
        <div>
          <p className="text-subtitle font-semibold text-foreground-muted">
            Entre na Jam em <span className="text-foreground">{PARTICIPANT_URL.replace(/^https?:\/\//, "")}</span>
          </p>
          <p className="mt-4 text-[9rem] font-extrabold leading-none tracking-widest text-foreground">
            {jam.code}
          </p>
        </div>

        <div className="flex items-center gap-8">
          {qr && (
            <div className="rounded-lg bg-white p-4 shadow-soft">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={`QR Code para entrar na Jam ${jam.code}`} className="h-44 w-44" />
            </div>
          )}
          <div className="max-w-xs">
            <p className="text-subtitle font-semibold">Escaneie para entrar</p>
            <p className="mt-2 text-body leading-relaxed text-foreground-muted">
              Sem cadastro, sem instalar nada. Escolha um nome e adicione sua
              música à fila.
            </p>
          </div>
        </div>

        {countdown !== null && nextSong && nextSinger ? (
          <div className="rounded-lg border border-primary/40 bg-primary/10 px-8 py-6">
            <p className="text-body text-foreground-muted">A seguir</p>
            <p className="mt-1 text-title font-bold">
              {nextSong.title}
              <span className="font-medium text-foreground-muted"> · {nextSinger.name}</span>
            </p>
            <p className="mt-2 text-subtitle font-semibold text-primary">
              Começando em {countdown}...
            </p>
          </div>
        ) : (
          <p className="text-subtitle text-foreground-muted">
            {jam.participants.length === 0
              ? "Aguardando os primeiros participantes..."
              : "Adicionem músicas à fila pelo celular para começar! 🎤"}
          </p>
        )}
      </section>

      {/* Coluna direita: quem chegou + fila + ranking */}
      <section className="flex min-h-0 flex-col justify-center gap-8">
        <div>
          <p className="mb-4 text-body font-semibold uppercase tracking-wider text-foreground-muted">
            Na Jam · {jam.participants.length}
          </p>
          <div className="flex flex-wrap gap-4">
            {jam.participants.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-full border border-border bg-surface px-4 py-2"
              >
                <Avatar
                  name={p.name}
                  size={32}
                  style={{ backgroundColor: `${p.color}33`, color: p.color }}
                />
                <span className="text-body font-semibold">{p.name}</span>
              </div>
            ))}
            {jam.participants.length === 0 && (
              <p className="text-body text-foreground-muted">Ninguém ainda — seja o primeiro!</p>
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
                const singer = jam.participants.find((p) => p.id === item.participantId);
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 rounded-md border border-border bg-surface px-5 py-3"
                  >
                    <span className="text-body font-bold text-foreground-muted">{i + 1}</span>
                    <span className="flex-1 truncate text-subtitle font-semibold">
                      {song?.title ?? "?"}
                    </span>
                    <span className="text-body text-foreground-muted">{singer?.name}</span>
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
    </main>
  );
}
