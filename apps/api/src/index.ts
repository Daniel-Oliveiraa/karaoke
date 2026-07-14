import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ScoreResult,
  ServerToClientEvents,
} from "@jamroom/shared-types";
import {
  INVITE_TIMEOUT_MS,
  MAX_SINGERS_PER_ITEM,
  acceptedSingerIds,
} from "@jamroom/shared-types";
import { FULL_CATALOG, MEDIA_DIR, getSong } from "./catalog";
import {
  addParticipant,
  addToQueue,
  applyResults,
  createJam,
  currentItem,
  endJam,
  getJam,
  nextQueued,
  removeFromQueue,
  resolveInviting,
  respondInvite,
  scheduleSave,
  skipCurrent,
} from "./store";

/**
 * API da Jam — MVP em memória.
 *
 * Protocolo definido em @jamroom/shared-types. O host (tela da TV) é o
 * relógio da verdade da reprodução; o participante calcula o próprio score
 * no client (pitch detection local, sem streamar áudio) e envia só o
 * resultado. O servidor valida quem pode enviar o quê e retransmite estado.
 */

interface SocketData {
  role?: "host" | "participant";
  code?: string;
  participantId?: string;
}

const PORT = Number(process.env.PORT ?? 4001);
/**
 * Porta HTTP pura, espelho da principal, para clientes que não conseguem
 * aceitar o certificado self-signed (navegador de TV): a tela host não
 * usa microfone, então não precisa de contexto seguro. Só sobe quando a
 * principal está em HTTPS. Desativar com HTTP_PORT=0.
 */
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 4000);

/**
 * TLS de desenvolvimento: getUserMedia (microfone) só existe em contexto
 * seguro, então o celular precisa falar HTTPS/WSS com a API. Se os
 * certificados de certs/ existirem, o servidor sobe em HTTPS; sem eles,
 * cai para HTTP puro (CI, etc).
 */
const CERT_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "certs");

function loadTls(): { key: Buffer; cert: Buffer } | null {
  try {
    return {
      key: readFileSync(join(CERT_DIR, "dev.key")),
      cert: readFileSync(join(CERT_DIR, "dev.crt")),
    };
  } catch {
    return null;
  }
}

const requestHandler = (req: IncomingMessage, res: ServerResponse) => {
  // Endpoints HTTP simples para debug/health — o produto usa Socket.io.
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === "/catalog") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(FULL_CATALOG));
    return;
  }
  // /media/<arquivo> — instrumentais das músicas reais, com suporte a Range
  // (o <audio> do navegador usa para seek/streaming).
  if (req.url?.startsWith("/media/")) {
    const name = normalize(decodeURIComponent(req.url.slice("/media/".length)));
    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
      res.writeHead(400);
      res.end();
      return;
    }
    const filePath = join(MEDIA_DIR, name);
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    const type =
      {
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".wav": "audio/wav",
        ".json": "application/json",
      }[extname(name).toLowerCase()] ?? "application/octet-stream";
    const range = req.headers.range;
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
      });
      createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
      });
      createReadStream(filePath).pipe(res);
    }
    return;
  }
  res.writeHead(404);
  res.end();
};

const tls = loadTls();
const httpServer = tls
  ? createHttpsServer(tls, requestHandler)
  : createServer(requestHandler);

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>(httpServer, {
  cors: { origin: "*" },
});

type JamSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const RESULT_FALLBACK_MS = 8000;
// override por env só para testes (o timeout real de produto é o do protocolo)
const INVITE_EXPIRE_MS = Number(process.env.INVITE_TIMEOUT_MS ?? INVITE_TIMEOUT_MS);

function broadcastState(code: string): void {
  const record = getJam(code);
  if (record) {
    io.to(code).emit("jam:state", record.jam);
    scheduleSave(); // toda mudança de estado passa por aqui
  }
}

/** Aplica os resultados da música atual e volta a Jam para o estado de fila. */
function finishCurrentSong(code: string, results: ScoreResult[]): void {
  const record = getJam(code);
  if (!record) return;
  if (record.resultTimeout) {
    clearTimeout(record.resultTimeout);
    record.resultTimeout = null;
  }
  record.pendingScores = null;
  applyResults(record.jam, results);
  record.jam.status = "results";
  record.jam.songStartedAt = null;
  broadcastState(code);
}

/** Finaliza a música se todos os cantores aceitos já enviaram score. */
function maybeFinishCurrentSong(code: string): void {
  const record = getJam(code);
  if (!record || record.jam.status !== "playing" || !record.pendingScores) return;
  const item = currentItem(record.jam);
  if (!item) return;
  const singerIds = acceptedSingerIds(item);
  if (singerIds.every((id) => record.pendingScores!.has(id))) {
    finishCurrentSong(code, [...record.pendingScores.values()]);
  }
}

io.on("connection", (socket: JamSocket) => {
  // ---------------------------------------------------------------- catálogo
  socket.on("catalog:get", (cb) => cb(FULL_CATALOG));

  // -------------------------------------------------------------------- host
  socket.on("host:create", (cb) => {
    const record = createJam();
    socket.data.role = "host";
    socket.data.code = record.jam.code;
    void socket.join(record.jam.code);
    scheduleSave();
    cb({ ok: true, jam: record.jam });
  });

  socket.on("host:attach", (code, cb) => {
    const record = getJam(code);
    if (!record) {
      cb({ ok: false, error: "Jam não encontrada" });
      return;
    }
    socket.data.role = "host";
    socket.data.code = code;
    void socket.join(code);
    cb({ ok: true, jam: record.jam });
  });

  socket.on("host:start_song", () => {
    const code = socket.data.code;
    if (socket.data.role !== "host" || !code) return;
    const record = getJam(code);
    if (!record || record.jam.status === "playing" || record.jam.status === "ended") return;
    const item = nextQueued(record.jam);
    if (!item || !getSong(item.songId)) return;
    item.status = "playing";
    record.jam.status = "playing";
    record.jam.currentItemId = item.id;
    record.jam.songStartedAt = Date.now();
    record.jam.lastResults = [];
    record.pendingScores = new Map();
    broadcastState(code);
  });

  socket.on("host:playback_started", () => {
    const code = socket.data.code;
    if (socket.data.role !== "host" || !code) return;
    const record = getJam(code);
    if (!record || record.jam.status !== "playing") return;
    // reancora o relógio da música no instante em que o áudio de fato
    // começou na TV (carregamento de mídia real leva algumas centenas de ms)
    record.jam.songStartedAt = Date.now();
    broadcastState(code);
  });

  socket.on("host:song_ended", () => {
    const code = socket.data.code;
    if (socket.data.role !== "host" || !code) return;
    const record = getJam(code);
    if (!record || record.jam.status !== "playing") return;
    const item = currentItem(record.jam);
    if (!item) return;
    // Espera o score de cada cantor; quem não enviar até o fallback
    // (celular travou/saiu) fecha com zero para a Jam nunca ficar presa.
    record.resultTimeout = setTimeout(() => {
      const song = getSong(item.songId);
      const pending = record.pendingScores ?? new Map<string, ScoreResult>();
      for (const singerId of acceptedSingerIds(item)) {
        if (!pending.has(singerId)) {
          pending.set(singerId, {
            queueItemId: item.id,
            songId: item.songId,
            participantId: singerId,
            score: 0,
            accuracy: 0,
            notesHit: 0,
            notesTotal: song?.notes.length ?? 0,
          });
        }
      }
      finishCurrentSong(code, [...pending.values()]);
    }, RESULT_FALLBACK_MS);
  });

  socket.on("host:continue", () => {
    const code = socket.data.code;
    if (socket.data.role !== "host" || !code) return;
    const record = getJam(code);
    if (!record || record.jam.status !== "results") return;
    record.jam.status = "lobby";
    record.jam.currentItemId = null;
    broadcastState(code);
  });

  socket.on("host:skip_song", () => {
    const code = socket.data.code;
    if (socket.data.role !== "host" || !code) return;
    const record = getJam(code);
    if (!record) return;
    if (record.resultTimeout) {
      clearTimeout(record.resultTimeout);
      record.resultTimeout = null;
    }
    record.pendingScores = null;
    if (skipCurrent(record.jam)) broadcastState(code);
  });

  socket.on("host:end_jam", () => {
    const code = socket.data.code;
    if (socket.data.role !== "host" || !code) return;
    const record = getJam(code);
    if (!record) return;
    endJam(record);
    io.to(code).emit("jam:ended", record.jam);
    broadcastState(code);
  });

  // ------------------------------------------------------------- participant
  socket.on("participant:join", ({ code, name }, cb) => {
    const record = getJam(code);
    if (!record || record.jam.status === "ended") {
      cb({ ok: false, error: "Jam não encontrada ou encerrada" });
      return;
    }
    const participant = addParticipant(record.jam, name);
    socket.data.role = "participant";
    socket.data.code = code;
    socket.data.participantId = participant.id;
    void socket.join(code);
    cb({ ok: true, participant, jam: record.jam });
    broadcastState(code);
  });

  socket.on("participant:rejoin", ({ code, participantId }, cb) => {
    const record = getJam(code);
    const participant = record?.jam.participants.find((p) => p.id === participantId);
    if (!record || !participant || record.jam.status === "ended") {
      cb({ ok: false, error: "Sessão expirada" });
      return;
    }
    participant.connected = true;
    socket.data.role = "participant";
    socket.data.code = code;
    socket.data.participantId = participantId;
    void socket.join(code);
    cb({ ok: true, participant, jam: record.jam });
    broadcastState(code);
  });

  socket.on("participant:add_song", ({ songId, inviteeIds }) => {
    const { code, participantId } = socket.data;
    if (socket.data.role !== "participant" || !code || !participantId) return;
    const record = getJam(code);
    if (!record || record.jam.status === "ended" || !getSong(songId)) return;
    // convidados válidos: existem na Jam, não são o dono, sem duplicata
    const invitees = [...new Set(inviteeIds ?? [])]
      .filter(
        (id) =>
          id !== participantId &&
          record.jam.participants.some((p) => p.id === id)
      )
      .slice(0, MAX_SINGERS_PER_ITEM - 1);
    const item = addToQueue(record.jam, songId, participantId, invitees);
    if (item.status === "inviting") {
      // sem resposta em INVITE_EXPIRE_MS: pendentes viram recusa e o item
      // resolve (entra na fila se alguém aceitou; senão o dono decide)
      record.inviteTimers.set(
        item.id,
        setTimeout(() => {
          record.inviteTimers.delete(item.id);
          if (item.status !== "inviting") return;
          for (const s of item.singers) {
            if (s.status === "invited") s.status = "declined";
          }
          resolveInviting(item);
          broadcastState(code);
        }, INVITE_EXPIRE_MS)
      );
    }
    broadcastState(code);
  });

  socket.on("participant:remove_song", (queueItemId) => {
    const { code, participantId } = socket.data;
    if (socket.data.role !== "participant" || !code || !participantId) return;
    const record = getJam(code);
    if (!record || record.jam.status === "ended") return;
    if (removeFromQueue(record.jam, queueItemId, participantId)) {
      const timer = record.inviteTimers.get(queueItemId);
      if (timer) clearTimeout(timer);
      record.inviteTimers.delete(queueItemId);
      broadcastState(code);
    }
  });

  socket.on("participant:skip_song", () => {
    const { code, participantId } = socket.data;
    if (socket.data.role !== "participant" || !code || !participantId) return;
    const record = getJam(code);
    if (!record) return;
    const item = currentItem(record.jam);
    if (!item) return;
    const singer = item.singers.find(
      (s) => s.participantId === participantId && s.status === "accepted"
    );
    if (!singer) return; // só quem está cantando pode sair
    singer.status = "declined";
    record.pendingScores?.delete(participantId);
    if (acceptedSingerIds(item).length === 0) {
      // último cantor desistiu: a música é pulada (caso solo original)
      if (record.resultTimeout) {
        clearTimeout(record.resultTimeout);
        record.resultTimeout = null;
      }
      record.pendingScores = null;
      if (skipCurrent(record.jam)) broadcastState(code);
      return;
    }
    // os demais continuam; quem ficou pode até já ter enviado score
    maybeFinishCurrentSong(code);
    broadcastState(code);
  });

  socket.on("participant:invite_response", ({ queueItemId, accept }) => {
    const { code, participantId } = socket.data;
    if (socket.data.role !== "participant" || !code || !participantId) return;
    const record = getJam(code);
    if (!record || record.jam.status === "ended") return;
    if (respondInvite(record.jam, queueItemId, participantId, accept)) {
      const item = record.jam.queue.find((i) => i.id === queueItemId);
      if (item) {
        resolveInviting(item);
        // todos responderam (virou "queued" ou caiu no "dono decide"):
        // o timer de expiração não tem mais o que fazer
        if (!item.singers.some((s) => s.status === "invited")) {
          const timer = record.inviteTimers.get(item.id);
          if (timer) clearTimeout(timer);
          record.inviteTimers.delete(item.id);
        }
      }
      broadcastState(code);
    }
  });

  socket.on("participant:resolve_item", ({ queueItemId, addSolo }) => {
    const { code, participantId } = socket.data;
    if (socket.data.role !== "participant" || !code || !participantId) return;
    const record = getJam(code);
    if (!record || record.jam.status === "ended") return;
    const item = record.jam.queue.find((i) => i.id === queueItemId);
    if (
      !item ||
      item.status !== "inviting" ||
      item.participantId !== participantId ||
      item.singers.some((s) => s.status === "invited") // ainda há pendente
    ) {
      return;
    }
    const timer = record.inviteTimers.get(item.id);
    if (timer) clearTimeout(timer);
    record.inviteTimers.delete(item.id);
    if (addSolo) {
      item.status = "queued";
    } else {
      record.jam.queue.splice(record.jam.queue.indexOf(item), 1);
    }
    broadcastState(code);
  });

  socket.on("participant:pitch", (sample) => {
    const { code, participantId } = socket.data;
    if (socket.data.role !== "participant" || !code || !participantId) return;
    const record = getJam(code);
    if (!record || record.jam.status !== "playing") return;
    const item = currentItem(record.jam);
    if (!item || !acceptedSingerIds(item).includes(participantId)) return; // só quem canta
    socket.to(code).emit("jam:pitch", { ...sample, participantId });
  });

  socket.on("participant:score", (result) => {
    const { code, participantId } = socket.data;
    if (socket.data.role !== "participant" || !code || !participantId) return;
    const record = getJam(code);
    if (!record || record.jam.status !== "playing") return;
    const item = currentItem(record.jam);
    if (!item || !acceptedSingerIds(item).includes(participantId)) return;
    if (!record.pendingScores) record.pendingScores = new Map();
    if (record.pendingScores.has(participantId)) return; // duplicata
    record.pendingScores.set(participantId, {
      queueItemId: item.id,
      songId: item.songId,
      participantId,
      score: Math.max(0, Math.min(1000, Math.round(result.score))),
      accuracy: Math.max(0, Math.min(1, result.accuracy)),
      notesHit: result.notesHit,
      notesTotal: result.notesTotal,
    });
    maybeFinishCurrentSong(code);
  });

  // ------------------------------------------- "voz na TV" (relay WebRTC)
  socket.on("participant:mic_signal", (data) => {
    const { code, participantId } = socket.data;
    if (socket.data.role !== "participant" || !code || !participantId) return;
    const record = getJam(code);
    if (!record || record.jam.status !== "playing") return;
    const item = currentItem(record.jam);
    if (!item || !acceptedSingerIds(item).includes(participantId)) return; // só quem canta
    socket.to(code).emit("jam:mic_signal", { participantId, data });
  });

  socket.on("host:mic_signal", (participantId, data) => {
    const code = socket.data.code;
    if (socket.data.role !== "host" || !code) return;
    if (!getJam(code)) return;
    socket.to(code).emit("jam:mic_signal", { participantId, data });
  });

  // ------------------------------------------------------------- desconexão
  socket.on("disconnect", () => {
    const { role, code, participantId } = socket.data;
    if (role !== "participant" || !code || !participantId) return;
    const record = getJam(code);
    const participant = record?.jam.participants.find((p) => p.id === participantId);
    if (!record || !participant) return;
    participant.connected = false;
    broadcastState(code);
  });
});

httpServer.listen(PORT, () => {
  const proto = tls ? "https" : "http";
  console.log(`[jamroom-api] ouvindo em ${proto}://localhost:${PORT}`);
});

if (tls && HTTP_PORT > 0) {
  const plainServer = createServer(requestHandler);
  io.attach(plainServer);
  plainServer.listen(HTTP_PORT, () => {
    console.log(
      `[jamroom-api] espelho HTTP (TV sem suporte a cert self-signed) em http://localhost:${HTTP_PORT}`
    );
  });
}
