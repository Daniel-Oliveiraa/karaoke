"use client";

import { useEffect, useMemo, useState } from "react";
import type { Jam, Participant, Song } from "@jamroom/shared-types";
import { acceptedSingerIds } from "@jamroom/shared-types";
import { HubView } from "@/components/HubView";
import { JamEndedView } from "@/components/JamEndedView";
import { JoinView } from "@/components/JoinView";
import { MyResultView } from "@/components/MyResultView";
import { SingView } from "@/components/SingView";
import { getSocket } from "@/lib/socket";

const SESSION_KEY = "jamroom-session";
const RESTORE_TIMEOUT_MS = 4000;

/**
 * App do participante — single page: a view é derivada do estado da Jam
 * (join → hub → sua vez → resultado → hub → ... → encerrada).
 *
 * A sessão (código + participantId) vive em localStorage: fechar e reabrir
 * o navegador reconecta direto na Jam via participant:rejoin, sem pedir
 * nome de novo. A sessão é descartada quando a Jam termina, quando o
 * servidor não a reconhece mais, ou quando um QR de OUTRA Jam é aberto.
 */
export default function ParticipantPage() {
  const [jam, setJam] = useState<Jam | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);

  // conexão + retomada de sessão (refresh ou reabertura do navegador)
  useEffect(() => {
    const socket = getSocket();
    socket.emit("catalog:get", setSongs);

    const onState = (j: Jam) => {
      setJam(j);
      // Jam acabou: a sessão salva não vale mais para a próxima visita
      if (j.status === "ended") localStorage.removeItem(SESSION_KEY);
    };
    socket.on("jam:state", onState);
    socket.on("jam:ended", onState);

    const urlCode = new URLSearchParams(window.location.search).get("code");
    const saved = localStorage.getItem(SESSION_KEY);
    let done = false;
    const finishRestore = () => {
      if (!done) {
        done = true;
        setRestoring(false);
      }
    };
    // API fora do ar / socket sem resposta: não prender o usuário no loading
    const failsafe = setTimeout(finishRestore, RESTORE_TIMEOUT_MS);

    if (saved) {
      try {
        const { code, participantId } = JSON.parse(saved) as {
          code: string;
          participantId: string;
        };
        if (urlCode && urlCode !== code) {
          // escaneou o QR de outra Jam — ela manda mais que a sessão antiga
          localStorage.removeItem(SESSION_KEY);
          finishRestore();
        } else {
          socket.emit("participant:rejoin", { code, participantId }, (res) => {
            if (res.ok && res.jam && res.participant) {
              setJam(res.jam);
              setMeId(res.participant.id);
            } else {
              localStorage.removeItem(SESSION_KEY);
            }
            finishRestore();
          });
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
        finishRestore();
      }
    } else {
      finishRestore();
    }

    return () => {
      clearTimeout(failsafe);
      socket.off("jam:state", onState);
      socket.off("jam:ended", onState);
    };
  }, []);

  function join(code: string, name: string) {
    setJoining(true);
    setJoinError(null);
    getSocket().emit("participant:join", { code, name }, (res) => {
      setJoining(false);
      if (res.ok && res.jam && res.participant) {
        setJam(res.jam);
        setMeId(res.participant.id);
        localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({ code, participantId: res.participant.id })
        );
      } else {
        setJoinError(res.error ?? "Não foi possível entrar na Jam");
      }
    });
  }

  const songsById = useMemo(
    () => new Map(songs.map((s) => [s.id, s] as const)),
    [songs]
  );

  const me = jam?.participants.find((p) => p.id === meId) ?? null;

  // sessão salva sendo retomada — não piscar o formulário de entrada
  if (restoring && !me) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-body text-foreground-muted">Voltando para a Jam...</p>
      </main>
    );
  }

  if (!jam || !me) {
    return <JoinView joining={joining} error={joinError} onJoin={join} />;
  }

  if (jam.status === "ended") {
    return <JamEndedView jam={jam} me={me} />;
  }

  // é a minha vez de cantar (solo ou como parte do dueto/grupo)?
  if (jam.status === "playing" && jam.currentItemId) {
    const item = jam.queue.find((i) => i.id === jam.currentItemId);
    const song = item ? songsById.get(item.songId) : undefined;
    if (item && song && acceptedSingerIds(item).includes(me.id)) {
      return <SingView jam={jam} song={song} me={me} />;
    }
  }

  // acabei de cantar?
  const myResult = jam.lastResults.find((r) => r.participantId === me.id);
  if (jam.status === "results" && myResult) {
    return (
      <MyResultView
        jam={jam}
        me={me}
        result={myResult}
        song={songsById.get(myResult.songId)}
      />
    );
  }

  return <HubView jam={jam} me={me} songs={songs} />;
}
