/**
 * Teste ponta a ponta do protocolo da Jam (sem navegador):
 * host cria a Jam → participante entra → adiciona música → host inicia →
 * participante manda pitch + score → leaderboard atualiza → duetos
 * (convite/aceite/recusa/expiração/fallback/desistência) → host encerra.
 *
 * Uso: node scripts/test-protocol.mjs
 * A API precisa estar de pé na :4001 **com INVITE_TIMEOUT_MS=2000** (o
 * cenário de expiração de convite espera ~2.6s em vez dos 60s reais).
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

const timeout = setTimeout(() => fail("timeout geral (45s)"), 45000);

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
part.emit("participant:add_song", { songId: song.id });
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
expect(state?.lastResults?.[0]?.score === 843, "score aplicado no resultado");
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
part.emit("participant:add_song", { songId: song.id });
await new Promise((r) => setTimeout(r, 150));
host.emit("host:start_song");
await new Promise((r) => setTimeout(r, 150));
host.emit("host:song_ended");
await new Promise((r) => setTimeout(r, 8500));
state = hostStates.at(-1);
expect(
  state?.status === "results" && state.lastResults?.[0]?.score === 0,
  "fallback fechou a música com score 0 quando o cantor sumiu"
);
host.emit("host:continue");

// 10. participante remove música própria da fila
part.emit("participant:add_song", { songId: song.id });
await new Promise((r) => setTimeout(r, 150));
state = hostStates.at(-1);
const toRemove = state.queue.find((i) => i.status === "queued");
part.emit("participant:remove_song", toRemove.id);
await new Promise((r) => setTimeout(r, 150));
state = hostStates.at(-1);
expect(
  !state.queue.some((i) => i.id === toRemove.id),
  "música removida da fila pelo dono"
);

// 11. pular música em andamento (host)
part.emit("participant:add_song", { songId: song.id });
await new Promise((r) => setTimeout(r, 150));
host.emit("host:start_song");
await new Promise((r) => setTimeout(r, 150));
host.emit("host:skip_song");
await new Promise((r) => setTimeout(r, 150));
state = hostStates.at(-1);
expect(
  state.status === "lobby" && state.currentItemId === null && state.lastResults.length === 0,
  "host pulou a música (sem resultado, direto para o lobby)"
);
expect(
  state.participants[0].totalScore === 843,
  "pulada não mexeu na pontuação"
);

// 12. cantor desiste da própria música
part.emit("participant:add_song", { songId: song.id });
await new Promise((r) => setTimeout(r, 150));
host.emit("host:start_song");
await new Promise((r) => setTimeout(r, 150));
part.emit("participant:skip_song");
await new Promise((r) => setTimeout(r, 150));
state = hostStates.at(-1);
expect(state.status === "lobby", "cantor desistiu e a Jam voltou ao lobby");

// ---------------------------------------------------------------- duetos
const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const last = () => hostStates.at(-1);
const scoreOf = (state2, id) =>
  state2.participants.find((p) => p.id === id)?.totalScore;

const part2 = connect();
const joined2 = await new Promise((res) =>
  part2.emit("participant:join", { code, name: "Duetinho" }, res)
);
expect(joined2.ok, "segundo participante entrou na Jam");
const p1 = joined.participant.id;
const p2 = joined2.participant.id;
const p1ScoreBefore = scoreOf(joined2.jam, p1);

/** Adiciona música com convite para p2 e retorna o item "inviting". */
async function addInviting() {
  part.emit("participant:add_song", { songId: song.id, inviteeIds: [p2] });
  await wait();
  return last().queue.find((i) => i.status === "inviting");
}

// 13. convite ANTES da fila: item nasce "inviting" e não toca
let item = await addInviting();
expect(
  item && item.singers.some((s) => s.participantId === p2 && s.status === "invited"),
  "música com convite nasce como 'inviting'"
);

host.emit("host:start_song");
await wait();
expect(last().status === "lobby", "item 'inviting' não entra na fila de reprodução");

part.emit("participant:resolve_item", { queueItemId: item.id, addSolo: true });
await wait();
expect(
  last().queue.find((i) => i.id === item.id)?.status === "inviting",
  "dono não resolve enquanto há resposta pendente"
);

// 14. aceite → item entra na fila e o dueto toca com dois scores
part2.emit("participant:invite_response", { queueItemId: item.id, accept: true });
await wait();
item = last().queue.find((i) => i.id === item.id);
expect(
  item.status === "queued" &&
    item.singers.some((s) => s.participantId === p2 && s.status === "accepted"),
  "aceite colocou a música na fila com o convidado confirmado"
);

host.emit("host:start_song");
await wait();
expect(last().status === "playing", "dueto tocando");

const pitch2Promise = new Promise((res) => host.once("jam:pitch", res));
part2.emit("participant:pitch", { t: 2, midi: 60, clarity: 0.8, centsOff: 0.1, hit: true });
const pitch2 = await pitch2Promise;
expect(pitch2.participantId === p2, "pitch do convidado chega ao host");

host.emit("host:song_ended");
part.emit("participant:score", { score: 850, accuracy: 0.85, notesHit: 41, notesTotal: 48 });
await wait(300);
expect(last().status === "playing", "1º score não encerra o dueto");
part2.emit("participant:score", { score: 700, accuracy: 0.7, notesHit: 34, notesTotal: 48 });
await wait(300);
state = last();
expect(
  state.status === "results" && state.lastResults.length === 2,
  "2º score encerra: resultado com os dois cantores"
);
expect(
  state.lastResults[0].score === 850 && state.lastResults[1].score === 700,
  "resultados ordenados por score"
);
expect(
  scoreOf(state, p1) === p1ScoreBefore + 850 && scoreOf(state, p2) === 700,
  "totalScore individual dos dois atualizado"
);
host.emit("host:continue");
await wait();

// 15. recusa → dono decide: cantar solo
item = await addInviting();
part2.emit("participant:invite_response", { queueItemId: item.id, accept: false });
await wait();
item = last().queue.find((i) => i.id === item.id);
expect(
  item.status === "inviting" &&
    item.singers.some((s) => s.participantId === p2 && s.status === "declined"),
  "recusa deixa o item aguardando a decisão do dono"
);
part2.emit("participant:resolve_item", { queueItemId: item.id, addSolo: true });
await wait();
expect(
  last().queue.find((i) => i.id === item.id)?.status === "inviting",
  "não-dono não resolve o item"
);
part.emit("participant:resolve_item", { queueItemId: item.id, addSolo: true });
await wait();
expect(
  last().queue.find((i) => i.id === item.id)?.status === "queued",
  "dono confirmou: música entrou na fila solo"
);
part.emit("participant:remove_song", item.id);
await wait();

// 16. recusa → dono decide: cancelar
item = await addInviting();
part2.emit("participant:invite_response", { queueItemId: item.id, accept: false });
await wait();
part.emit("participant:resolve_item", { queueItemId: item.id, addSolo: false });
await wait();
expect(
  !last().queue.some((i) => i.id === item.id),
  "dono cancelou: item removido da fila"
);

// 17. timeout do convite (API com INVITE_TIMEOUT_MS=2000): vira recusa
item = await addInviting();
await wait(2600);
item = last().queue.find((i) => i.id === item.id);
expect(
  item.status === "inviting" &&
    item.singers.find((s) => s.participantId === p2)?.status === "declined",
  "convite sem resposta expirou e caiu na decisão do dono"
);
part.emit("participant:resolve_item", { queueItemId: item.id, addSolo: false });
await wait();

// 18. convidado inexistente é ignorado: entra solo direto
part.emit("participant:add_song", { songId: song.id, inviteeIds: ["nao-existe"] });
await wait();
item = last().queue.at(-1);
expect(
  item.status === "queued" && item.singers.length === 1,
  "convidado inexistente ignorado — música entrou solo"
);
part.emit("participant:remove_song", item.id);
await wait();

// 19. convite pendente não bloqueia a fila dos outros
item = await addInviting();
part2.emit("participant:add_song", { songId: song.id });
await wait();
host.emit("host:start_song");
await wait();
state = last();
expect(
  state.status === "playing" &&
    state.queue.find((i) => i.id === state.currentItemId)?.participantId === p2,
  "música solo de outro participante toca enquanto o convite espera"
);
host.emit("host:skip_song");
await wait();
part2.emit("participant:invite_response", { queueItemId: item.id, accept: true });
await wait();
expect(
  last().queue.find((i) => i.id === item.id)?.status === "queued",
  "aceite tardio (antes do timeout) ainda vale"
);
part.emit("participant:remove_song", item.id);
await wait();

// 20. fallback parcial: um cantor some, o outro fecha com o próprio score
item = await addInviting();
part2.emit("participant:invite_response", { queueItemId: item.id, accept: true });
await wait();
host.emit("host:start_song");
await wait();
host.emit("host:song_ended");
part.emit("participant:score", { score: 500, accuracy: 0.5, notesHit: 24, notesTotal: 48 });
await wait(8500);
state = last();
expect(
  state.status === "results" &&
    state.lastResults.length === 2 &&
    state.lastResults.find((r) => r.participantId === p2)?.score === 0,
  "fallback fechou o cantor sumido com 0 e manteve o score do outro"
);
host.emit("host:continue");
await wait();

// 21. membro desiste no meio: a música segue para quem ficou
item = await addInviting();
part2.emit("participant:invite_response", { queueItemId: item.id, accept: true });
await wait();
host.emit("host:start_song");
await wait();
part2.emit("participant:skip_song");
await wait();
expect(last().status === "playing", "desistência de um membro não pula a música");
host.emit("host:song_ended");
part.emit("participant:score", { score: 600, accuracy: 0.6, notesHit: 29, notesTotal: 48 });
await wait(300);
state = last();
expect(
  state.status === "results" && state.lastResults.length === 1,
  "resultado só de quem ficou até o fim"
);
host.emit("host:continue");
await wait();

// 22. todos desistem: música pulada sem resultado
item = await addInviting();
part2.emit("participant:invite_response", { queueItemId: item.id, accept: true });
await wait();
host.emit("host:start_song");
await wait();
part2.emit("participant:skip_song");
part.emit("participant:skip_song");
await wait();
expect(
  last().status === "lobby" && last().lastResults.length === 0,
  "todos desistiram: música pulada sem resultado"
);

// 23. host encerra
const endedPromise = new Promise((res) => part.once("jam:ended", res));
host.emit("host:end_jam");
const ended = await endedPromise;
expect(ended.status === "ended", "Jam encerrada propagada ao participante");

clearTimeout(timeout);
console.log("\nPROTOCOLO OK — todos os passos passaram.");
process.exit(0);
