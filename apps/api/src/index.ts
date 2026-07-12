import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ScoreResult,
  ServerToClientEvents,
} from "@jamroom/shared-types";
import { FULL_CATALOG, MEDIA_DIR, getSong } from "./catalog";
import {
  addParticipant,
  addToQueue,
  applyResult,
  createJam,
  currentItem,
  endJam,
  getJam,
  nextQueued,
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

const httpServer = createServer((req, res) => {
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
      { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".json": "application/json" }[
        extname(name).toLowerCase()
      ] ?? "application/octet-stream";
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
});

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

function broadcastState(code: string): void {
  const record = getJam(code);
  if (record) io.to(code).emit("jam:state", record.jam);
}

/** Aplica o resultado da música atual e volta a Jam para o estado de fila. */
function finishCurrentSong(code: string, result: ScoreResult): void {
  const record = getJam(code);
  if (!record) return;
  if (record.resultTimeout) {
    clearTimeout(record.resultTimeout);
    record.resultTimeout = null;
  }
  applyResult(record.jam, result);
  record.jam.status = "results";
  record.jam.songStartedAt = null;
  broadcastState(code);
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
    record.jam.lastResult = null;
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
    // Espera o score do cantor; se não vier (celular travou/saiu), fecha
    // a música com score zero para a Jam nunca ficar presa.
    record.resultTimeout = setTimeout(() => {
      const song = getSong(item.songId);
      finishCurrentSong(code, {
        queueItemId: item.id,
        songId: item.songId,
        participantId: item.participantId,
        score: 0,
        accuracy: 0,
        notesHit: 0,
        notesTotal: song?.notes.length ?? 0,
      });
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

  socket.on("participant:add_song", (songId) => {
    const { code, participantId } = socket.data;
    if (socket.data.role !== "participant" || !code || !participantId) return;
    const record = getJam(code);
    if (!record || record.jam.status === "ended" || !getSong(songId)) return;
    addToQueue(record.jam, songId, participantId);
    broadcastState(code);
  });

  socket.on("participant:pitch", (sample) => {
    const { code, participantId } = socket.data;
    if (socket.data.role !== "participant" || !code || !participantId) return;
    const record = getJam(code);
    if (!record || record.jam.status !== "playing") return;
    const item = currentItem(record.jam);
    if (!item || item.participantId !== participantId) return; // só o cantor da vez
    socket.to(code).emit("jam:pitch", { ...sample, participantId });
  });

  socket.on("participant:score", (result) => {
    const { code, participantId } = socket.data;
    if (socket.data.role !== "participant" || !code || !participantId) return;
    const record = getJam(code);
    if (!record || record.jam.status !== "playing") return;
    const item = currentItem(record.jam);
    if (!item || item.participantId !== participantId) return;
    finishCurrentSong(code, {
      queueItemId: item.id,
      songId: item.songId,
      participantId,
      score: Math.max(0, Math.min(1000, Math.round(result.score))),
      accuracy: Math.max(0, Math.min(1, result.accuracy)),
      notesHit: result.notesHit,
      notesTotal: result.notesTotal,
    });
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
  console.log(`[jamroom-api] ouvindo em http://localhost:${PORT}`);
});
