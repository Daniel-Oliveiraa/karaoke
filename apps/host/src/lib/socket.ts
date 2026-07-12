"use client";

import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@jamroom/shared-types";

export type JamSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

/**
 * URL base do app do participante, usada no QR Code. Em rede local,
 * defina NEXT_PUBLIC_PARTICIPANT_URL com o IP da máquina
 * (ex: http://192.168.0.10:3002) para os celulares alcançarem o app.
 */
export const PARTICIPANT_URL =
  process.env.NEXT_PUBLIC_PARTICIPANT_URL ?? "http://localhost:3002";

let socket: JamSocket | null = null;

export function getSocket(): JamSocket {
  if (!socket) {
    socket = io(API_URL, { transports: ["websocket"] });
  }
  return socket;
}
