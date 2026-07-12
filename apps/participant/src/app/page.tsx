"use client";

import { useEffect, useMemo, useState } from "react";
import type { Jam, Participant, Song } from "@jamroom/shared-types";
import { HubView } from "@/components/HubView";
import { JamEndedView } from "@/components/JamEndedView";
import { JoinView } from "@/components/JoinView";
import { MyResultView } from "@/components/MyResultView";
import { SingView } from "@/components/SingView";
import { getSocket } from "@/lib/socket";

const SESSION_KEY = "jamroom-session";

/**
 * App do participante — single page: a view é derivada do estado da Jam
 * (join → hub → sua vez → resultado → hub → ... → encerrada).
 */
export default function ParticipantPage() {
  const [jam, setJam] = useState<Jam | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // conexão + tentativa de reconexão (refresh do celular)
  useEffect(() => {
    const socket = getSocket();
    socket.emit("catalog:get", setSongs);

    const onState = (j: Jam) => setJam(j);
    socket.on("jam:state", onState);
    socket.on("jam:ended", onState);

    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        const { code, participantId } = JSON.parse(saved) as {
          code: string;
          participantId: string;
        };
        socket.emit("participant:rejoin", { code, participantId }, (res) => {
          if (res.ok && res.jam && res.participant) {
            setJam(res.jam);
            setMeId(res.participant.id);
          } else {
            sessionStorage.removeItem(SESSION_KEY);
          }
        });
      } catch {
        sessionStorage.removeItem(SESSION_KEY);
      }
    }

    return () => {
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
        sessionStorage.setItem(
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

  if (!jam || !me) {
    return <JoinView joining={joining} error={joinError} onJoin={join} />;
  }

  if (jam.status === "ended") {
    return <JamEndedView jam={jam} me={me} />;
  }

  // é a minha vez de cantar?
  if (jam.status === "playing" && jam.currentItemId) {
    const item = jam.queue.find((i) => i.id === jam.currentItemId);
    const song = item ? songsById.get(item.songId) : undefined;
    if (item?.participantId === me.id && song) {
      return <SingView jam={jam} song={song} me={me} />;
    }
  }

  // acabei de cantar?
  if (jam.status === "results" && jam.lastResult?.participantId === me.id) {
    return (
      <MyResultView
        jam={jam}
        me={me}
        result={jam.lastResult}
        song={songsById.get(jam.lastResult.songId)}
      />
    );
  }

  return <HubView jam={jam} me={me} songs={songs} />;
}
