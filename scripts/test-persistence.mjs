/**
 * Teste da persistência das Jams no servidor: cria Jam + participante,
 * o operador reinicia a API entre as etapas, e o rejoin/attach devem
 * funcionar com a Jam restaurada do snapshot.
 *
 * Uso (o próprio script reinicia a API via porta):
 *   node scripts/test-persistence.mjs create   -> cria e imprime code/participantId
 *   node scripts/test-persistence.mjs verify <code> <participantId>
 */
import { io } from "socket.io-client";

const API = process.env.API_URL ?? "https://localhost:4001";

function connect() {
  return io(API, { transports: ["websocket"], rejectUnauthorized: false });
}

const mode = process.argv[2];

if (mode === "create") {
  const host = connect();
  const part = connect();
  const created = await new Promise((res) => host.emit("host:create", res));
  const code = created.jam.code;
  const joined = await new Promise((res) =>
    part.emit("participant:join", { code, name: "Persistente" }, res)
  );
  // uma música na fila para validar que a fila também sobrevive
  const songs = await new Promise((res) => part.emit("catalog:get", res));
  part.emit("participant:add_song", songs[0].id);
  await new Promise((r) => setTimeout(r, 400)); // snapshot debounce 300ms
  console.log(JSON.stringify({ code, participantId: joined.participant.id }));
  process.exit(0);
}

if (mode === "verify") {
  const [, , , code, participantId] = process.argv;
  const host = connect();
  const part = connect();

  const attached = await new Promise((res) => host.emit("host:attach", code, res));
  if (!attached.ok) {
    console.error("FALHOU: host:attach não achou a Jam restaurada");
    process.exit(1);
  }
  console.log("ok - Jam", code, "restaurada após restart");

  const rejoined = await new Promise((res) =>
    part.emit("participant:rejoin", { code, participantId }, res)
  );
  if (!rejoined.ok || rejoined.participant?.name !== "Persistente") {
    console.error("FALHOU: rejoin não reconheceu o participante");
    process.exit(1);
  }
  console.log("ok - participante reconhecido após restart:", rejoined.participant.name);

  const queued = rejoined.jam.queue.filter((i) => i.status === "queued").length;
  if (queued !== 1) {
    console.error(`FALHOU: fila não sobreviveu (${queued} itens)`);
    process.exit(1);
  }
  console.log("ok - fila sobreviveu ao restart (1 música)");
  console.log("\nPERSISTENCIA DO SERVIDOR OK");
  process.exit(0);
}

console.error("uso: node test-persistence.mjs create|verify <code> <participantId>");
process.exit(1);
