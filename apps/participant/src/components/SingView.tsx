"use client";

import { useEffect, useRef, useState } from "react";
import { Button, PitchMeter, ProgressBar } from "@jamroom/ui";
import type { Jam, Participant, Song } from "@jamroom/shared-types";
import { startPitchCapture, type PitchCapture } from "@/lib/pitchDetector";
import { ScoreTracker, type FrameJudgement } from "@/lib/scoring";
import { getSocket } from "@/lib/socket";

const PITCH_EMIT_INTERVAL_MS = 150;

/**
 * "Sua vez de cantar": pede o microfone (gesto do usuário, exigência dos
 * navegadores), roda o detector de pitch local e acumula o score contra a
 * melodia de referência. Ao final envia só o resultado ao servidor.
 */
export function SingView({
  jam,
  song,
  me,
}: {
  jam: Jam;
  song: Song;
  me: Participant;
}) {
  const [capturing, setCapturing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [judge, setJudge] = useState<FrameJudgement | null>(null);
  const [done, setDone] = useState(false);

  const trackerRef = useRef<ScoreTracker | null>(null);
  const captureRef = useRef<PitchCapture | null>(null);
  const startRef = useRef<number | null>(null); // performance.now() do t=0 da música
  const sentRef = useRef(false);
  const lastEmitRef = useRef(0);

  // tracker novo a cada música
  useEffect(() => {
    trackerRef.current = new ScoreTracker(song);
    sentRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jam.currentItemId]);

  // t=0 da música: preferir o relógio do servidor (funciona em rejoin no
  // meio da música e é reancorado pelo host quando o áudio real começa);
  // se o skew for absurdo, cair para o momento do mount.
  useEffect(() => {
    const serverElapsed = jam.songStartedAt
      ? (Date.now() - jam.songStartedAt) / 1000
      : 0;
    const sane = serverElapsed >= 0 && serverElapsed < song.durationSec + 5;
    startRef.current = performance.now() - (sane ? serverElapsed * 1000 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jam.currentItemId, jam.songStartedAt]);

  // relógio de tela + envio do score no fim
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const start = startRef.current;
      if (start !== null) {
        const t = (performance.now() - start) / 1000;
        setTime(t);
        if (t > song.durationSec + 0.5 && !sentRef.current && trackerRef.current) {
          sentRef.current = true;
          getSocket().emit("participant:score", trackerRef.current.finish());
          captureRef.current?.stop();
          captureRef.current = null;
          setCapturing(false);
          setDone(true);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [song.durationSec]);

  // desmontagem: libera o microfone
  useEffect(
    () => () => {
      captureRef.current?.stop();
      captureRef.current = null;
    },
    []
  );

  async function enableMic() {
    setMicError(null);
    try {
      const capture = await startPitchCapture((frame) => {
        const start = startRef.current;
        const tracker = trackerRef.current;
        if (start === null || !tracker || sentRef.current) return;
        const t = (performance.now() - start) / 1000;
        const j = tracker.feed(t, frame.hz, frame.clarity);
        setJudge(j);

        const now = performance.now();
        if (now - lastEmitRef.current >= PITCH_EMIT_INTERVAL_MS) {
          lastEmitRef.current = now;
          getSocket().emit("participant:pitch", {
            t,
            midi: j.midi,
            clarity: frame.clarity,
            centsOff: j.centsOff,
            hit: j.hit,
          });
        }
      });
      captureRef.current = capture;
      setCapturing(true);
    } catch {
      setMicError(
        "Não conseguimos acessar seu microfone. Verifique a permissão no navegador."
      );
    }
  }

  const currentLine =
    song.lines.find((l) => time >= l.start && time < l.end) ??
    song.lines.find((l) => l.start > time) ??
    null;

  const progress = Math.min(1, Math.max(0, time / song.durationSec));

  if (done) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-4xl">🎉</p>
        <p className="text-subtitle font-bold">Mandou bem, {me.name}!</p>
        <p className="text-body text-foreground-muted">Calculando sua pontuação...</p>
      </main>
    );
  }

  return (
    <main
      className="flex min-h-dvh flex-col px-6 py-8"
      style={{
        background:
          "radial-gradient(90% 60% at 50% 0%, rgba(124,58,237,0.3), transparent 60%), #09090B",
      }}
    >
      <header className="text-center">
        <p className="text-caption font-semibold uppercase tracking-wider text-primary">
          É a sua vez!
        </p>
        <p className="mt-1 text-subtitle font-bold">{song.title}</p>
        <p className="text-caption text-foreground-muted">{song.artist}</p>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        {!capturing ? (
          <>
            <p className="max-w-[280px] text-body leading-relaxed text-foreground-muted">
              Libere o microfone para valer pontos. A música já está tocando na
              TV — cante junto com ela!
            </p>
            <Button
              variant="primary"
              className="w-full max-w-xs justify-center py-4 text-body font-semibold"
              onClick={enableMic}
            >
              🎤 Liberar microfone e cantar
            </Button>
            {micError && <p className="max-w-xs text-caption text-error">{micError}</p>}
          </>
        ) : (
          <>
            {/* letra de apoio no celular */}
            <p className="min-h-16 max-w-[320px] text-2xl font-extrabold leading-snug">
              {currentLine?.text ?? "♪"}
            </p>

            {/* barra de afinação */}
            <PitchMeter
              className="max-w-xs"
              centsOff={judge?.centsOff ?? null}
              hit={judge?.hit ?? false}
              idleLabel="cante para o marcador aparecer"
              hitLabel="afinado! ✨"
            />

            <div className="flex items-center gap-2 text-caption text-foreground-muted">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-error" />
              capturando sua voz — nada é enviado, a análise é no seu celular
            </div>
          </>
        )}
      </section>

      <footer>
        <ProgressBar value={progress} />
      </footer>
    </main>
  );
}
