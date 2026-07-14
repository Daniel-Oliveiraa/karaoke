/**
 * @jamroom/shared-types — contratos compartilhados entre api, host e
 * participant. Fonte única de verdade dos dados da Jam: qualquer mudança
 * de protocolo começa aqui.
 */

// ---------------------------------------------------------------------------
// Catálogo / música
// ---------------------------------------------------------------------------

/** Uma nota da melodia de referência, em tempo absoluto da música. */
export interface MelodyNote {
  /** Início da nota em segundos desde o começo da música. */
  start: number;
  /** Duração da nota em segundos. */
  duration: number;
  /** Altura em MIDI (69 = A4/440Hz). */
  midi: number;
}

/** Uma linha da letra sincronizada (granularidade de linha no MVP). */
export interface LyricLine {
  start: number;
  end: number;
  text: string;
}

/**
 * Curva de pitch de referência. No MVP ela é derivada da grade de notas da
 * melodia (`MelodyNote[]`); com catálogo B2B real passará a ser extraída da
 * faixa original (pipeline Demucs+CREPE), mantendo o mesmo formato.
 */
export interface PitchCurve {
  /** Timestamps em segundos, ordenados. */
  times: number[];
  /** MIDI (fracionário) em cada timestamp; null = silêncio/sem voz. */
  midi: (number | null)[];
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  genre: string;
  durationSec: number;
  bpm: number;
  /** Par de cores (hex) para a "capa" gerada por gradiente — sem assets no MVP. */
  coverColors: [string, string];
  lines: LyricLine[];
  notes: MelodyNote[];
  /**
   * Caminho (relativo à API, ex: "/media/knock.mp3") da faixa instrumental
   * licenciada para reprodução na tela host. null/ausente = música demo
   * sintetizada a partir de `notes`.
   */
  audioUrl?: string | null;
  /** Atribuição obrigatória da licença (ex: "CC BY 4.0 — Josh Woodward"). */
  attribution?: string;
}

/** Versão leve da música para listagens (busca no participant). */
export type SongSummary = Omit<Song, "lines" | "notes">;

// ---------------------------------------------------------------------------
// Jam / sessão
// ---------------------------------------------------------------------------

export type JamStatus = "lobby" | "playing" | "results" | "ended";

export interface Participant {
  id: string;
  name: string;
  /** Cor do avatar (hex), sorteada na entrada. */
  color: string;
  totalScore: number;
  connected: boolean;
  joinedAt: number;
}

export type QueueItemStatus = "queued" | "playing" | "done";

/** Situação de um cantor num item da fila (duetos/grupos). */
export type SingerStatus = "invited" | "accepted" | "declined";

export interface QueueSinger {
  participantId: string;
  status: SingerStatus;
  invitedAt: number;
}

/** Máximo de cantores por música (legibilidade da TV). */
export const MAX_SINGERS_PER_ITEM = 4;
/** Máximo de celulares simultâneos como "voz na TV". */
export const MAX_TV_MICS = 2;

export interface QueueItem {
  id: string;
  songId: string;
  /** Dono do item: quem adicionou (controla remoção e convites). */
  participantId: string;
  /**
   * Quem canta esta música. O dono entra automaticamente como "accepted";
   * convidados entram como "invited" e precisam aceitar. Convites pendentes
   * expiram ("declined") quando a música começa.
   */
  singers: QueueSinger[];
  status: QueueItemStatus;
  addedAt: number;
}

/** Ids dos cantores confirmados de um item (dono + convidados que aceitaram). */
export function acceptedSingerIds(item: QueueItem): string[] {
  return item.singers
    .filter((s) => s.status === "accepted")
    .map((s) => s.participantId);
}

export interface ScoreResult {
  queueItemId: string;
  songId: string;
  participantId: string;
  /** Pontuação final da música, 0–1000. */
  score: number;
  /** Fração de acerto de afinação, 0–1. */
  accuracy: number;
  notesHit: number;
  notesTotal: number;
}

export interface Jam {
  code: string;
  status: JamStatus;
  participants: Participant[];
  queue: QueueItem[];
  /** Item em execução quando status === "playing" | "results". */
  currentItemId: string | null;
  /** Epoch ms (relógio do servidor) em que a música atual começou. */
  songStartedAt: number | null;
  /**
   * Resultados da última música, ordenados por score desc (um por cantor;
   * solo = 1 elemento; [] = sem resultado a exibir).
   */
  lastResults: ScoreResult[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Pitch ao vivo (participant → host, para feedback visual)
// ---------------------------------------------------------------------------

export interface LivePitch {
  participantId: string;
  /** Posição na música em segundos (relógio do cantor). */
  t: number;
  /** MIDI detectado (fracionário) ou null quando sem voz. */
  midi: number | null;
  /** Clareza/confiança do detector, 0–1. */
  clarity: number;
  /** Distância em semitons até a nota de referência ativa (null = sem nota). */
  centsOff: number | null;
  /** Se o frame conta como acerto para o score. */
  hit: boolean;
}

// ---------------------------------------------------------------------------
// "Voz na TV" — sinalização WebRTC (celular como microfone da tela host)
// ---------------------------------------------------------------------------

/**
 * Payload de sinalização WebRTC retransmitido pelo servidor (SDP ou ICE).
 * O servidor não interpreta o conteúdo — só encaminha entre o cantor da vez
 * e o host da mesma Jam.
 */
export interface MicSignalData {
  description?: { type: "offer" | "answer"; sdp: string };
  candidate?: unknown;
}

// ---------------------------------------------------------------------------
// Protocolo Socket.io
// ---------------------------------------------------------------------------

export interface JoinResult {
  ok: boolean;
  error?: string;
  participant?: Participant;
  jam?: Jam;
}

export interface CreateResult {
  ok: boolean;
  error?: string;
  jam?: Jam;
}

/** Eventos que os clients emitem para o servidor. */
export interface ClientToServerEvents {
  /** Host cria uma Jam nova e entra na sala dela. */
  "host:create": (cb: (res: CreateResult) => void) => void;
  /** Host reconecta a uma Jam existente (refresh da tela da TV). */
  "host:attach": (code: string, cb: (res: CreateResult) => void) => void;
  /** Host inicia a próxima música da fila. */
  "host:start_song": () => void;
  /**
   * O áudio começou de fato a tocar na TV (após carregar/decodificar).
   * O servidor reancora `songStartedAt` nesse instante para o relógio do
   * score do participante casar com o áudio real.
   */
  "host:playback_started": () => void;
  /** Host sinaliza que a reprodução terminou (é o relógio da verdade). */
  "host:song_ended": () => void;
  /** Host avança da tela de resultado de volta para a fila/lobby. */
  "host:continue": () => void;
  /** Host pula a música em andamento (sem pontuação, sem tela de resultado). */
  "host:skip_song": () => void;
  /** Host encerra a Jam. */
  "host:end_jam": () => void;

  /** Participante entra na Jam por código. */
  "participant:join": (
    payload: { code: string; name: string },
    cb: (res: JoinResult) => void
  ) => void;
  /** Participante reconecta com um id existente (refresh do celular). */
  "participant:rejoin": (
    payload: { code: string; participantId: string },
    cb: (res: JoinResult) => void
  ) => void;
  "participant:add_song": (songId: string) => void;
  /** Participante remove uma música SUA que ainda está na fila. */
  "participant:remove_song": (queueItemId: string) => void;
  /**
   * Dono de um item ainda na fila convida outro participante para cantar
   * junto (dueto/grupo). O convite viaja no snapshot `jam:state`.
   */
  "participant:invite": (payload: {
    queueItemId: string;
    inviteeId: string;
  }) => void;
  /** Convidado aceita ou recusa um convite de dueto/grupo. */
  "participant:invite_response": (payload: {
    queueItemId: string;
    accept: boolean;
  }) => void;
  /**
   * O cantor sai da música em andamento (sem pontuação para ele). Se não
   * sobrar nenhum cantor aceito, a música é pulada.
   */
  "participant:skip_song": () => void;
  /** Amostra de pitch ao vivo (retransmitida ao host). */
  "participant:pitch": (sample: Omit<LivePitch, "participantId">) => void;
  /** Score final calculado no client ao fim da música. */
  "participant:score": (
    result: Pick<ScoreResult, "score" | "accuracy" | "notesHit" | "notesTotal">
  ) => void;

  /** Sinalização WebRTC do cantor → host ("voz na TV"). */
  "participant:mic_signal": (data: MicSignalData) => void;
  /** Sinalização WebRTC do host → um participante específico. */
  "host:mic_signal": (participantId: string, data: MicSignalData) => void;

  /** Catálogo de músicas (com letra + melodia). */
  "catalog:get": (cb: (songs: Song[]) => void) => void;
}

/** Eventos que o servidor emite para os clients. */
export interface ServerToClientEvents {
  /** Snapshot completo da Jam — clients re-renderizam a partir dele. */
  "jam:state": (jam: Jam) => void;
  /** Pitch ao vivo retransmitido (host usa para a barra de afinação). */
  "jam:pitch": (sample: LivePitch) => void;
  /** A Jam foi encerrada pelo host. */
  "jam:ended": (jam: Jam) => void;
  /**
   * Sinalização WebRTC retransmitida. No host, `participantId` identifica o
   * cantor de origem; no participante, indica o destinatário (ignorar se
   * não for o próprio id).
   */
  "jam:mic_signal": (payload: {
    participantId: string;
    data: MicSignalData;
  }) => void;
}

// ---------------------------------------------------------------------------
// Utilidades compartilhadas
// ---------------------------------------------------------------------------

/** Converte MIDI em frequência (Hz). */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Converte frequência (Hz) em MIDI fracionário. */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/**
 * Distância de afinação em semitons, tolerante a oitava (cantar uma oitava
 * acima/abaixo da referência não é considerado erro).
 */
export function semitoneDistance(midiA: number, midiB: number): number {
  const d = Math.abs(midiA - midiB) % 12;
  return Math.min(d, 12 - d);
}

/** Deriva a PitchCurve (amostrada) da grade de notas — usada em telas de gráfico. */
export function pitchCurveFromNotes(
  notes: MelodyNote[],
  stepSec = 0.05
): PitchCurve {
  const times: number[] = [];
  const midi: (number | null)[] = [];
  if (notes.length === 0) return { times, midi };
  const last = notes[notes.length - 1]!;
  const total = last.start + last.duration;
  let noteIdx = 0;
  for (let t = 0; t <= total + 1e-9; t += stepSec) {
    while (
      noteIdx < notes.length - 1 &&
      t >= notes[noteIdx]!.start + notes[noteIdx]!.duration
    ) {
      noteIdx++;
    }
    const n = notes[noteIdx]!;
    times.push(Number(t.toFixed(3)));
    midi.push(t >= n.start && t < n.start + n.duration ? n.midi : null);
  }
  return { times, midi };
}

/** Nota de referência ativa num instante da música (ou null). */
export function noteAt(notes: MelodyNote[], t: number): MelodyNote | null {
  for (const n of notes) {
    if (t >= n.start && t < n.start + n.duration) return n;
    if (n.start > t) break;
  }
  return null;
}
