import type { Derby } from '@derby/core';
import type { WebSocket } from 'ws';
import type { TimerStatus } from './timer/service.js';
import type { BackupStatus } from './backup.js';

/** What the next Undo would revert, for the coordinator's button. */
export interface UndoInfo {
  /** Command name (or 'timerResult') of the change that would be undone. */
  label: string;
  at: string;
}

export type ServerMessage =
  | { type: 'state'; state: Derby; undo: UndoInfo | null; redo: UndoInfo | null }
  | { type: 'backup'; backup: BackupStatus }
  /** Which build of the web app is on disk; pages reload when it changes. */
  | { type: 'build'; build: string }
  | { type: 'timer'; timer: TimerStatus }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string };

export interface ClientInfo {
  /** First path segment of the page: coordinator, audience, pit, judges, replay, home... */
  page: string;
  /** The page runs in a secure context (https or localhost), so cameras work. */
  secure: boolean;
  /** The browser exposes a camera API. */
  camera: boolean;
  /** Connected over the HTTPS listener. */
  tls: boolean;
  /** Remote address, to tell phones from the race laptop. */
  ip: string;
  userAgent: string;
  connectedAt: number;
}

/** Fan-out of server messages to every connected screen. */
export class Hub {
  private clients = new Map<WebSocket, ClientInfo>();

  add(socket: WebSocket, info: Partial<ClientInfo> = {}): void {
    this.clients.set(socket, { page: 'unknown', secure: false, camera: false, tls: false, ip: '', userAgent: '', connectedAt: Date.now(), ...info });
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
  }

  /** A page announced itself (its route, secure context, camera support). */
  describe(socket: WebSocket, info: Partial<ClientInfo>): void {
    const current = this.clients.get(socket);
    if (current) this.clients.set(socket, { ...current, ...info });
  }

  list(): ClientInfo[] {
    return [...this.clients.values()];
  }

  get size(): number {
    return this.clients.size;
  }

  broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients.keys()) {
      if (client.readyState === client.OPEN) client.send(data);
    }
  }

  send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}
