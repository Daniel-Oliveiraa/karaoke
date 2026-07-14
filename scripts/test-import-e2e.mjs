/**
 * Teste LENTO (~5–10 min) da importação pelo app, de ponta a ponta:
 * busca no YouTube via socket → catalog:import_youtube de uma música NOVA →
 * Demucs/pyin/LRCLIB no servidor → catalog:new_song chega ao client.
 *
 * Uso: node scripts/test-import-e2e.mjs "artista música" (API de pé)
 * Não roda no CI — exige rede + CPU por vários minutos.
 */
import { io } from "socket.io-client";

const API = process.env.API_URL ?? "https://localhost:4001";
const QUERY = process.argv[2] ?? "josh woodward crazy glue";
const IMPORT_TIMEOUT_MIN = 15;

const socket = io(API, { transports: ["websocket"], rejectUnauthorized: false });

function fail(msg) {
  console.error("FALHOU:", msg);
  process.exit(1);
}

// precisa ser participante para buscar/importar
const jamRes = await new Promise((res) => {
  const host = io(API, { transports: ["websocket"], rejectUnauthorized: false });
  host.emit("host:create", (r) => res(r));
});
if (!jamRes.ok) fail("não criou jam");
const joined = await new Promise((res) =>
  socket.emit("participant:join", { code: jamRes.jam.code, name: "Importador" }, res)
);
if (!joined.ok) fail("não entrou na jam");

console.log(`buscando: ${QUERY}`);
const results = await new Promise((res) =>
  socket.emit("catalog:search_youtube", QUERY, res)
);
if (!results.length) fail("busca vazia");
const pick = results[0];
console.log(`importando: ${pick.title} (${pick.videoId}, ${pick.durationSec}s)`);

const seenStages = new Set();
socket.on("catalog:import_update", (job) => {
  if (job.videoId !== pick.videoId) return;
  console.log(`  job: ${job.status} — ${job.stage} · ${job.progress}%`);
  if (job.progress > 0) seenStages.add(job.stage);
  if (job.status === "failed") {
    fail(`import falhou: ${job.error}`);
  }
});

const newSongPromise = new Promise((res) => {
  socket.on("catalog:new_song", (song) => {
    console.log(`catalog:new_song: ${song.artist} - ${song.title} (${song.id})`);
    res(song);
  });
  // dedupe (já estava no catálogo) também conta como sucesso
  socket.on("catalog:import_update", (job) => {
    if (job.videoId === pick.videoId && job.status === "done") {
      setTimeout(() => res({ id: job.songId, dedupe: true }), 500);
    }
  });
});

const ack = await new Promise((res) =>
  socket.emit("catalog:import_youtube", { videoId: pick.videoId, title: pick.title }, res)
);
if (!ack.ok) fail(`pedido recusado: ${ack.error}`);
console.log("pedido aceito — aguardando processamento (Demucs leva minutos)...");

const timer = setTimeout(
  () => fail(`timeout de ${IMPORT_TIMEOUT_MIN} min`),
  IMPORT_TIMEOUT_MIN * 60 * 1000
);
const song = await newSongPromise;
clearTimeout(timer);

if (!song?.id) fail("música sem id");
if (!song.dedupe && seenStages.size < 2) {
  fail(
    `progresso real esperado (≥2 estágios distintos), só vi: ${[...seenStages].join(", ")}`
  );
}
console.log(
  `\nIMPORT_E2E OK — ${song.id}${song.dedupe ? " (dedupe)" : ` — estágios vistos: ${[...seenStages].join(" → ")}`}`
);
process.exit(0);
