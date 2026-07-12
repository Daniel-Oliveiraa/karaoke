"use client";

import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@jamroom/shared-types";

export type JamSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

let socket: JamSocket | null = null;

export function getSocket(): JamSocket {
  if (!socket) {
    socket = io(API_URL, { transports: ["websocket"] });
  }
  return socket;
}
