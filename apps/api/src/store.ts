import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Jam,
  Participant,
  QueueItem,
  ScoreResult,
} from "@jamroom/shared-types";

/**
 * Estado das Jams em memória, com snapshot em arquivo JSON: reiniciar a
 * API não derruba as Jams ativas nem invalida as sessões salvas nos
 * celulares. É a versão MVP do que futuramente vive em Redis
 * (fila/leaderboard/presença) + Postgres (histórico): trocar este módulo
 * por essas fontes não muda o protocolo de socket.
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
  /** Timer de fallback caso algum cantor nunca envie o score. */
  resultTimeout: NodeJS.Timeout | null;
  /**
   * Scores já recebidos da música atual, por participantId. Só em memória:
   * no restart o item "playing" volta para a fila de qualquer forma.
   */
  pendingScores: Map<string, ScoreResult> | null;
  /** Timers de expiração de convite, por queueItemId (só memória). */
  inviteTimers: Map<string, NodeJS.Timeout>;
}

const jams = new Map<string, JamRecord>();

const ENDED_TTL_MS = 60 * 60 * 1000; // jams encerradas somem depois de 1h
const STALE_JAM_MS = 24 * 60 * 60 * 1000; // não restaurar jams com +24h

const DATA_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "jams.json"
);

let saveTimer: NodeJS.Timeout | null = null;

/** Agenda um snapshot das Jams em disco (debounce de 300ms). */
export function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(DATA_FILE), { recursive: true });
      const snapshot = [...jams.values()]
        .filter((r) => r.jam.status !== "ended")
        .map((r) => r.jam);
      writeFileSync(DATA_FILE, JSON.stringify(snapshot), "utf-8");
    } catch (err) {
      console.warn("[store] falha ao salvar snapshot:", err);
    }
  }, 300);
  saveTimer.unref();
}

/**
 * Restaura as Jams do último snapshot. Estado transitório é saneado:
 * música que estava tocando volta para a fila (o relógio da reprodução
 * morreu com o processo) e participantes começam como desconectados até
 * o rejoin.
 */
function loadJams(): void {
  let raw: string;
  try {
    raw = readFileSync(DATA_FILE, "utf-8");
  } catch {
    return; // primeiro boot
  }
  try {
    const snapshot = JSON.parse(raw) as Jam[];
    const now = Date.now();
    for (const jam of snapshot) {
      if (!jam?.code || jam.status === "ended") continue;
      if (now - jam.createdAt > STALE_JAM_MS) continue;
      // migração de snapshots pré-duetos (QueueItem sem singers,
      // Jam com lastResult singular)
      for (const item of jam.queue) {
        if (!Array.isArray(item.singers)) {
          item.singers = [
            {
              participantId: item.participantId,
              status: "accepted",
              invitedAt: item.addedAt,
            },
          ];
        }
      }
      if (!Array.isArray(jam.lastResults)) {
        const legacy = (jam as { lastResult?: ScoreResult | null }).lastResult;
        jam.lastResults = legacy ? [legacy] : [];
        delete (jam as { lastResult?: ScoreResult | null }).lastResult;
      }
      if (jam.status === "playing" || jam.status === "results") {
        for (const item of jam.queue) {
          if (item.status === "playing") item.status = "queued";
        }
        jam.status = "lobby";
        jam.currentItemId = null;
        jam.songStartedAt = null;
      }
      // convites pendentes não sobrevivem ao restart (o timer morreu):
      // pendentes viram recusa; sem parceiro aceito, o dono revê o popup
      // de decisão quando reconectar
      for (const item of jam.queue) {
        if (item.status === "inviting") {
          for (const s of item.singers) {
            if (s.status === "invited") s.status = "declined";
          }
          resolveInviting(item);
        }
      }
      for (const p of jam.participants) p.connected = false;
      jams.set(jam.code, {
        jam,
        resultTimeout: null,
        pendingScores: null,
        inviteTimers: new Map(),
      });
    }
    if (jams.size > 0) {
      console.log(
        `[store] ${jams.size} jam(s) restaurada(s):`,
        [...jams.keys()].join(", ")
      );
    }
  } catch (err) {
    console.warn("[store] snapshot inválido, começando vazio:", err);
  }
}

loadJams();

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
    lastResults: [],
    createdAt: Date.now(),
  };
  const record: JamRecord = {
    jam,
    resultTimeout: null,
    pendingScores: null,
    inviteTimers: new Map(),
  };
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

export function addToQueue(
  jam: Jam,
  songId: string,
  participantId: string,
  inviteeIds: string[] = []
): QueueItem {
  const now = Date.now();
  const item: QueueItem = {
    id: randomUUID(),
    songId,
    participantId,
    singers: [
      { participantId, status: "accepted", invitedAt: now },
      ...inviteeIds.map((id) => ({
        participantId: id,
        status: "invited" as const,
        invitedAt: now,
      })),
    ],
    status: inviteeIds.length > 0 ? "inviting" : "queued",
    addedAt: now,
  };
  jam.queue.push(item);
  return item;
}

/** Convidado aceita/recusa. Só transiciona "invited" em item "inviting". */
export function respondInvite(
  jam: Jam,
  queueItemId: string,
  participantId: string,
  accept: boolean
): boolean {
  const item = jam.queue.find((i) => i.id === queueItemId);
  if (!item || item.status !== "inviting") return false;
  const singer = item.singers.find(
    (s) => s.participantId === participantId && s.status === "invited"
  );
  if (!singer) return false;
  singer.status = accept ? "accepted" : "declined";
  return true;
}

/**
 * Tenta resolver um item "inviting": sem respostas pendentes E com algum
 * co-cantor aceito, a música entra na fila ("queued"). Sem co-cantor, o item
 * fica "inviting" sem pendentes = estado "dono decide" (solo ou cancela),
 * derivado no client a partir do snapshot. True = virou "queued".
 */
export function resolveInviting(item: QueueItem): boolean {
  if (item.status !== "inviting") return false;
  if (item.singers.some((s) => s.status === "invited")) return false;
  const hasPartner = item.singers.some(
    (s) => s.status === "accepted" && s.participantId !== item.participantId
  );
  if (hasPartner) {
    item.status = "queued";
    return true;
  }
  return false;
}

export function nextQueued(jam: Jam): QueueItem | undefined {
  return jam.queue.find((i) => i.status === "queued");
}

export function currentItem(jam: Jam): QueueItem | undefined {
  return jam.queue.find((i) => i.id === jam.currentItemId);
}

export function applyResults(jam: Jam, results: ScoreResult[]): void {
  const item = jam.queue.find((i) => i.id === results[0]?.queueItemId);
  if (item) item.status = "done";
  for (const result of results) {
    const participant = jam.participants.find((p) => p.id === result.participantId);
    if (participant) participant.totalScore += result.score;
  }
  jam.lastResults = [...results].sort((a, b) => b.score - a.score);
}

export function endJam(record: JamRecord): void {
  record.jam.status = "ended";
  if (record.resultTimeout) clearTimeout(record.resultTimeout);
  record.resultTimeout = null;
  for (const t of record.inviteTimers.values()) clearTimeout(t);
  record.inviteTimers.clear();
  scheduleSave();
  setTimeout(() => jams.delete(record.jam.code), ENDED_TTL_MS).unref();
}

/** Remove uma música da fila (itens não tocados; inclui convite pendente). */
export function removeFromQueue(jam: Jam, queueItemId: string, participantId: string): boolean {
  const idx = jam.queue.findIndex(
    (i) =>
      i.id === queueItemId &&
      i.participantId === participantId &&
      (i.status === "queued" || i.status === "inviting")
  );
  if (idx < 0) return false;
  jam.queue.splice(idx, 1);
  return true;
}

/** Encerra a música atual sem pontuação (pulada/desistida). */
export function skipCurrent(jam: Jam): boolean {
  if (jam.status !== "playing") return false;
  const item = jam.queue.find((i) => i.id === jam.currentItemId);
  if (item) item.status = "done";
  jam.status = "lobby";
  jam.currentItemId = null;
  jam.songStartedAt = null;
  jam.lastResults = [];
  return true;
}
