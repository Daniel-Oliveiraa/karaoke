import { randomUUID } from "node:crypto";
import type {
  Jam,
  Participant,
  QueueItem,
  ScoreResult,
} from "@jamroom/shared-types";

/**
 * Estado das Jams em memória. É a versão MVP do que futuramente vive em
 * Redis (fila/leaderboard/presença) + Postgres (histórico): trocar este
 * módulo por essas fontes não muda o protocolo de socket.
 */

const AVATAR_COLORS = [
  "#7C3AED",
  "#3B82F6",
  "#22C55E",
  "#FACC15",
  "#EF4444",
  "#D946EF",
  "#F97316",
  "#14B8A6",
];

export interface JamRecord {
  jam: Jam;
  /** Timer de fallback caso o participante nunca envie o score. */
  resultTimeout: NodeJS.Timeout | null;
}

const jams = new Map<string, JamRecord>();

const ENDED_TTL_MS = 60 * 60 * 1000; // jams encerradas somem depois de 1h

function newCode(): string {
  for (;;) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!jams.has(code)) return code;
  }
}

export function createJam(): JamRecord {
  const jam: Jam = {
    code: newCode(),
    status: "lobby",
    participants: [],
    queue: [],
    currentItemId: null,
    songStartedAt: null,
    lastResult: null,
    createdAt: Date.now(),
  };
  const record: JamRecord = { jam, resultTimeout: null };
  jams.set(jam.code, record);
  return record;
}

export function getJam(code: string): JamRecord | undefined {
  return jams.get(code);
}

export function addParticipant(jam: Jam, name: string): Participant {
  const participant: Participant = {
    id: randomUUID(),
    name: name.trim().slice(0, 24) || "Cantor",
    color: AVATAR_COLORS[jam.participants.length % AVATAR_COLORS.length]!,
    totalScore: 0,
    connected: true,
    joinedAt: Date.now(),
  };
  jam.participants.push(participant);
  return participant;
}

export function addToQueue(jam: Jam, songId: string, participantId: string): QueueItem {
  const item: QueueItem = {
    id: randomUUID(),
    songId,
    participantId,
    status: "queued",
    addedAt: Date.now(),
  };
  jam.queue.push(item);
  return item;
}

export function nextQueued(jam: Jam): QueueItem | undefined {
  return jam.queue.find((i) => i.status === "queued");
}

export function currentItem(jam: Jam): QueueItem | undefined {
  return jam.queue.find((i) => i.id === jam.currentItemId);
}

export function applyResult(jam: Jam, result: ScoreResult): void {
  const item = jam.queue.find((i) => i.id === result.queueItemId);
  if (item) item.status = "done";
  const participant = jam.participants.find((p) => p.id === result.participantId);
  if (participant) participant.totalScore += result.score;
  jam.lastResult = result;
}

export function endJam(record: JamRecord): void {
  record.jam.status = "ended";
  if (record.resultTimeout) clearTimeout(record.resultTimeout);
  record.resultTimeout = null;
  setTimeout(() => jams.delete(record.jam.code), ENDED_TTL_MS).unref();
}
