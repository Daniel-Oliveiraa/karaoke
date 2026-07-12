/**
 * Teste ponta a ponta do protocolo da Jam (sem navegador):
 * host cria a Jam → participante entra → adiciona música → host inicia →
 * participante manda pitch + score → leaderboard atualiza → host encerra.
 *
 * Uso: node scripts/test-protocol.mjs  (API precisa estar de pé na :4001)
 */
import { io } from "socket.io-client";

const API = process.env.API_URL ?? "https://localhost:4001";

function connect() {
  // certificado self-signed de dev (certs/) — não validar
  return io(API, { transports: ["websocket"], rejectUnauthorized: false });
}

function fail(msg) {
  console.error("FALHOU:", msg);
  process.exit(1);
}

function expect(cond, msg) {
  if (!cond) fail(msg);
  console.log("ok -", msg);
}

const host = connect();
const part = connect();

const timeout = setTimeout(() => fail("timeout geral (15s)"), 15000);

const hostStates = [];
host.on("jam:state", (j) => hostStates.push(j));

// 1. host cria a jam
const created = await new Promise((res) => host.emit("host:create", res));
expect(created.ok && created.jam?.code?.length === 4, "host criou a Jam com código de 4 dígitos");
const code = created.jam.code;

// 2. catálogo disponível
const songs = await new Promise((res) => part.emit("catalog:get", res));
expect(songs.length >= 5, `catálogo com ${songs.length} músicas`);
const song = songs[0];

// 3. participante entra
const joined = await new Promise((res) =>
  part.emit("participant:join", { code, name: "Testinho" }, res)
);
expect(joined.ok && joined.participant?.name === "Testinho", "participante entrou na Jam");

// 4. participante adiciona música
part.emit("participant:add_song", song.id);
await new Promise((r) => setTimeout(r, 200));
let state = hostStates.at(-1);
expect(state?.queue.length === 1 && state.queue[0].songId === song.id, "música entrou na fila");

// 5. host inicia a música
host.emit("host:start_song");
await new Promise((r) => setTimeout(r, 200));
state = hostStates.at(-1);
expect(state?.status === "playing" && state.songStartedAt !== null, "Jam tocando");

// 6. pitch ao vivo chega no host
const pitchPromise = new Promise((res) => host.once("jam:pitch", res));
part.emit("participant:pitch", { t: 3, midi: 67.02, clarity: 0.9, centsOff: 0.02, hit: true });
const pitch = await pitchPromise;
expect(pitch.participantId === joined.participant.id && pitch.hit, "pitch retransmitido ao host");

// 7. fim da música: host sinaliza, participante manda o score
host.emit("host:song_ended");
part.emit("participant:score", { score: 843, accuracy: 0.843, notesHit: 40, notesTotal: 48 });
await new Promise((r) => setTimeout(r, 300));
state = hostStates.at(-1);
expect(state?.status === "results", "Jam em resultados");
expect(state?.lastResult?.score === 843, "score aplicado no resultado");
expect(
  state?.participants[0]?.totalScore === 843,
  "leaderboard atualizado com 843 pts"
);
expect(state?.queue[0]?.status === "done", "item da fila concluído");

// 8. host continua → volta pro lobby
host.emit("host:continue");
await new Promise((r) => setTimeout(r, 200));
state = hostStates.at(-1);
expect(state?.status === "lobby", "voltou ao lobby");

// 9. fallback: música sem score fecha com 0 depois do timeout
part.emit("participant:add_song", song.id);
await new Promise((r) => setTimeout(r, 150));
host.emit("host:start_song");
await new Promise((r) => setTimeout(r, 150));
host.emit("host:song_ended");
await new Promise((r) => setTimeout(r, 8500));
state = hostStates.at(-1);
expect(
  state?.status === "results" && state.lastResult?.score === 0,
  "fallback fechou a música com score 0 quando o cantor sumiu"
);
host.emit("host:continue");

// 10. host encerra
const endedPromise = new Promise((res) => part.once("jam:ended", res));
host.emit("host:end_jam");
const ended = await endedPromise;
expect(ended.status === "ended", "Jam encerrada propagada ao participante");

clearTimeout(timeout);
console.log("\nPROTOCOLO OK — todos os passos passaram.");
process.exit(0);
