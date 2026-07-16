"use client";

import { useEffect, useState } from "react";
import { PitchMeter, ProgressBar } from "@kantai/ui";
import type { Jam, LivePitch, Song } from "@kantai/shared-types";
import { acceptedSingerIds } from "@kantai/shared-types";
import type { MicEngine, MicStats } from "@/lib/micReceiver";
import { PARTICIPANT_URL } from "@/lib/socket";
import QRCode from "qrcode";

/**
 * Player — música em andamento. "A TV é um palco": letra protagonista,
 * fontes enormes, poucos elementos (docs/layoutDesc_extracted.txt).
 * Duetos/grupos: um medidor de afinação por cantor, lado a lado.
 */
export function PlayerView({
  jam,
  song,
  time,
  pitches,
  songsById,
  micStats,
  micBlocked,
  micEngine,
  onSkip,
}: {
  jam: Jam;
  song: Song;
  time: number;
  pitches: Map<string, LivePitch>;
  songsById: Map<string, Song>;
  micStats?: Map<string, MicStats>;
  /** Autoplay travou o áudio da voz — mostrar o aviso mesmo sem conexão. */
  micBlocked?: boolean;
  /** Motor de playback ativo — Smart TVs raramente têm devtools acessível
   * pra checar window.__tvmic.engine, então mostramos aqui também. */
  micEngine?: MicEngine;
  onSkip?: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const joinUrl = `${PARTICIPANT_URL}/?code=${jam.code}`;

  useEffect(() => {
    QRCode.toDataURL(joinUrl, {
      width: 160,
      margin: 1,
      color: { dark: "#09090B", light: "#FFFFFF" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [joinUrl]);

  const item = jam.queue.find((i) => i.id === jam.currentItemId);
  const singers = item
    ? acceptedSingerIds(item)
        .map((id) => jam.participants.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
    : [];

  const currentIdx = song.lines.findIndex((l) => time >= l.start && time < l.end);
  const upcomingIdx = song.lines.findIndex((l) => l.start > time);
  const activeIdx = currentIdx >= 0 ? currentIdx : -1;
  const current = activeIdx >= 0 ? song.lines[activeIdx] : null;
  const next =
    activeIdx >= 0 ? song.lines[activeIdx + 1] : upcomingIdx >= 0 ? song.lines[upcomingIdx] : null;

  const firstLineStart = song.lines[0]?.start ?? 0;
  const leadCountdown = time < firstLineStart ? Math.ceil(firstLineStart - time) : null;

  const queued = jam.queue.filter((i) => i.status === "queued");
  const nextItem = queued[0];
  const nextSong = nextItem ? songsById.get(nextItem.songId) : undefined;
  const nextSingerNames = nextItem
    ? nextItem.singers
        .filter((s) => s.status !== "declined")
        .map(
          (s) => jam.participants.find((p) => p.id === s.participantId)?.name ?? "?"
        )
        .join(" & ")
    : "";

  const progress = Math.min(1, Math.max(0, time / song.durationSec));
  const remaining = Math.max(0, Math.round(song.durationSec - time));

  // medidor "voz na TV" agregado (até 2 celulares conectados)
  const mics = [...(micStats?.values() ?? [])];
  const anyBlocked = Boolean(micBlocked) || mics.some((m) => m.audioBlocked);
  const worstMic = mics.reduce<MicStats | null>(
    (worst, m) => (worst === null || m.totalMs > worst.totalMs ? m : worst),
    null
  );

  return (
    <main
      className="relative flex h-full flex-col"
      style={{
        background:
          "radial-gradient(120% 90% at 75% 10%, rgba(124,58,237,0.4), transparent 55%), radial-gradient(90% 70% at 20% 100%, rgba(59,130,246,0.25), transparent 60%), #09090B",
      }}
    >
      {/* medidor do protótipo "voz na TV" */}
      {(worstMic || anyBlocked) && (
        <div
          className={`absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-1.5 backdrop-blur-glass ${
            anyBlocked
              ? "border-warning/60 bg-warning/15"
              : "border-white/10 bg-background/70"
          }`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              !anyBlocked && mics.every((m) => m.connected)
                ? "bg-success"
                : "bg-warning animate-pulse"
            }`}
          />
          {anyBlocked ? (
            <span className="text-caption font-semibold text-warning">
              Som bloqueado pelo navegador — clique na tela da TV para liberar
            </span>
          ) : (
            <>
              <span className="text-caption font-semibold text-foreground">
                Voz na TV{mics.length > 1 ? ` ×${mics.length}` : ""} · ~
                {worstMic?.totalMs ?? 0} ms
              </span>
              <span className="text-caption text-foreground-muted">
                (rede {worstMic?.networkMs ?? 0} · buffer{" "}
                {worstMic?.jitterBufferMs ?? 0} · saída {worstMic?.outputMs ?? 0} ·
                motor {micEngine === "script-processor" ? "fallback" : micEngine ?? "?"})
              </span>
            </>
          )}
        </div>
      )}

      {/* cantores atuais */}
      <header className="flex items-start justify-between p-12">
        <div>
          <p className="text-title font-bold">
            {singers.map((p) => p.name).join(" & ") || "—"}
          </p>
          <p className="mt-1 text-subtitle text-foreground-muted">
            {singers.length > 1 ? "cantando juntos" : "cantando agora"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-subtitle font-semibold">{song.title}</p>
          <p className="mt-1 text-body text-foreground-muted">{song.artist}</p>
        </div>
      </header>

      {/* letra protagonista */}
      <section className="flex flex-1 flex-col items-center justify-center gap-8 px-16 text-center">
        {leadCountdown !== null ? (
          <p className="text-[8rem] font-extrabold text-primary">{leadCountdown}</p>
        ) : (
          <>
            <p
              className={
                current
                  ? "bg-gradient-to-r from-primary to-secondary bg-clip-text text-6xl font-extrabold leading-tight text-transparent"
                  : "text-6xl font-extrabold leading-tight text-foreground-muted/50"
              }
            >
              {current?.text ?? next?.text ?? "♪"}
            </p>
            {current && next && (
              <p className="text-4xl font-bold text-foreground-muted/50">{next.text}</p>
            )}
          </>
        )}

        {/* barra de afinação ao vivo — uma por cantor */}
        <div className="mt-8 flex flex-wrap items-end justify-center gap-x-10 gap-y-4">
          {singers.map((p) => {
            const pitch = pitches.get(p.id) ?? null;
            return (
              <div
                key={p.id}
                className={`${singers.length > 1 ? "w-[300px]" : "w-[420px]"} text-center`}
              >
                {singers.length > 1 && (
                  <p
                    className="mb-2 truncate text-body font-semibold"
                    style={{ color: p.color }}
                  >
                    {p.name}
                  </p>
                )}
                <PitchMeter
                  centsOff={pitch?.centsOff ?? null}
                  hit={pitch?.hit ?? false}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* QR fixo num canto: quem chegar depois consegue entrar mesmo com a música rolando */}
      {qr && (
        <div className="absolute bottom-32 left-6 z-10 flex items-center gap-3 rounded-lg border border-white/10 bg-background/80 p-2.5 backdrop-blur-glass">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`QR Code para entrar na Jam ${jam.code}`} className="h-20 w-20 rounded" />
          <div className="pr-1.5">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-foreground-muted">
              Entrar na Jam
            </p>
            <p className="text-subtitle font-bold tracking-widest text-foreground">{jam.code}</p>
          </div>
        </div>
      )}

      {/* barra inferior: progresso, próxima e código */}
      <footer className="border-t border-white/10 bg-background/70 px-12 py-6 backdrop-blur-glass">
        <ProgressBar value={progress} />
        <div className="mt-4 flex items-center justify-between">
          <p className="text-body text-foreground-muted">
            {nextSong ? (
              <>
                Próxima: <span className="font-semibold text-foreground">{nextSong.title}</span>
                {" · "}
                {nextSingerNames}
              </>
            ) : (
              "Fila vazia — adicionem a próxima pelo celular!"
            )}
          </p>
          <div className="flex items-center gap-6">
            <p className="text-body text-foreground-muted">
              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} restantes ·
              Jam <span className="font-bold tracking-widest text-foreground">{jam.code}</span>
            </p>
            {onSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="rounded-md border border-border px-4 py-2 text-caption font-semibold text-foreground-muted transition-colors hover:border-primary/50 hover:text-foreground"
              >
                Pular música ⏭
              </button>
            )}
          </div>
        </div>
      </footer>
    </main>
  );
}
