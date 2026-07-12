"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import type { Jam, LivePitch, Song } from "@jamroom/shared-types";
import { Button } from "@jamroom/ui";
import { EndedView } from "@/components/EndedView";
import { LobbyView } from "@/components/LobbyView";
import { PlayerView } from "@/components/PlayerView";
import { ResultsView } from "@/components/ResultsView";
import { createMicReceiver, type MicStats } from "@/lib/micReceiver";
import { API_URL, getSocket } from "@/lib/socket";
import { playSong, type SynthPlayback } from "@/lib/synth";

const AUTO_START_SECONDS = 5;
const AUTO_CONTINUE_SECONDS = 8;

/**
 * Tela da sessão na TV. Sem interação direta (é "um palco"): a própria tela
 * conduz o fluxo — inicia a próxima música da fila com contagem regressiva,
 * detecta o fim da reprodução e avança do resultado de volta para a fila.
 */
export default function SessionPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);

  const [jam, setJam] = useState<Jam | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [pitch, setPitch] = useState<LivePitch | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [secondsToNext, setSecondsToNext] = useState<number | null>(null);
  const [micStats, setMicStats] = useState<MicStats | null>(null);

  const playbackRef = useRef<SynthPlayback | null>(null);
  const endedSentRef = useRef(false);

  const songsById = useMemo(
    () => new Map(songs.map((s) => [s.id, s] as const)),
    [songs]
  );

  // conexão + estado da Jam
  useEffect(() => {
    const socket = getSocket();
    socket.emit("host:attach", code, (res) => {
      if (res.ok && res.jam) setJam(res.jam);
      else setError(res.error ?? "Jam não encontrada");
    });
    socket.emit("catalog:get", setSongs);

    const onState = (j: Jam) => setJam(j);
    const onPitch = (p: LivePitch) => setPitch(p);
    socket.on("jam:state", onState);
    socket.on("jam:pitch", onPitch);
    socket.on("jam:ended", onState);
    return () => {
      socket.off("jam:state", onState);
      socket.off("jam:pitch", onPitch);
      socket.off("jam:ended", onState);
    };
  }, [code]);

  // reprodução: começa quando o servidor coloca a Jam em "playing"
  const playingItemId = jam?.status === "playing" ? jam.currentItemId : null;
  const playingSongId = playingItemId
    ? (jam?.queue.find((i) => i.id === playingItemId)?.songId ?? null)
    : null;

  useEffect(() => {
    if (!playingItemId || !playingSongId) return;
    const song = songsById.get(playingSongId);
    if (!song) return;

    endedSentRef.current = false;
    setPitch(null);
    setTime(0);
    const playback = playSong(song, API_URL, () =>
      getSocket().emit("host:playback_started")
    );
    playbackRef.current = playback;

    let raf = 0;
    const tick = () => {
      const t = playback.getTime();
      setTime(t);
      if (t > song.durationSec && !endedSentRef.current) {
        endedSentRef.current = true;
        getSocket().emit("host:song_ended");
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      playback.stop();
      playbackRef.current = null;
    };
    // songsById muda de referência a cada catálogo; a música em si não.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingItemId, playingSongId, songs.length]);

  // "voz na TV": receptor WebRTC ativo enquanto uma música toca
  useEffect(() => {
    if (!playingItemId) return;
    const receiver = createMicReceiver(setMicStats);
    return () => receiver.stop();
  }, [playingItemId]);

  // lobby: contagem regressiva para a próxima da fila
  const hasQueued = Boolean(jam?.queue.some((i) => i.status === "queued"));
  const inLobby = jam?.status === "lobby";
  useEffect(() => {
    if (!inLobby || !hasQueued) {
      setCountdown(null);
      return;
    }
    setCountdown(AUTO_START_SECONDS);
    const iv = setInterval(() => {
      setCountdown((c) => {
        if (c === null) return null;
        if (c <= 1) {
          clearInterval(iv);
          getSocket().emit("host:start_song");
          return null;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [inLobby, hasQueued]);

  // resultado: volta para a fila automaticamente
  const inResults = jam?.status === "results";
  useEffect(() => {
    if (!inResults) {
      setSecondsToNext(null);
      return;
    }
    setSecondsToNext(AUTO_CONTINUE_SECONDS);
    const iv = setInterval(() => {
      setSecondsToNext((c) => {
        if (c === null) return null;
        if (c <= 1) {
          clearInterval(iv);
          getSocket().emit("host:continue");
          return null;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [inResults]);

  if (error) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-title font-bold">Ops!</p>
        <p className="text-subtitle text-foreground-muted">{error}</p>
      </main>
    );
  }

  if (!jam || songs.length === 0) {
    return (
      <main className="flex h-full items-center justify-center">
        <p className="text-subtitle text-foreground-muted">Preparando a Jam...</p>
      </main>
    );
  }

  if (jam.status === "ended") return <EndedView jam={jam} />;

  if (jam.status === "playing" && playingSongId) {
    const song = songsById.get(playingSongId);
    if (song) {
      return (
        <PlayerView
          jam={jam}
          song={song}
          time={time}
          pitch={pitch}
          songsById={songsById}
          micStats={micStats}
        />
      );
    }
  }

  if (jam.status === "results" && jam.lastResult) {
    return <ResultsView jam={jam} songsById={songsById} secondsToNext={secondsToNext} />;
  }

  return (
    <>
      <LobbyView jam={jam} songsById={songsById} countdown={countdown} />
      {/* controle discreto de encerramento (o dashboard do anfitrião ainda não existe) */}
      <div className="absolute bottom-6 right-6">
        <Button
          variant="ghost"
          className="text-caption text-foreground-muted"
          onClick={() => getSocket().emit("host:end_jam")}
        >
          Encerrar Jam
        </Button>
      </div>
    </>
  );
}
