import type { Diagnostics, HistoryEntry, ServerInfo, ServerMessage } from './types.ts';

const PIN_KEY = 'derby.pin';

export function getPin(): string {
  try {
    return localStorage.getItem(PIN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setPin(pin: string): void {
  try {
    localStorage.setItem(PIN_KEY, pin);
  } catch {
    /* private mode */
  }
}

class CommandError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function command<T = unknown>(name: string, args?: unknown): Promise<T> {
  const res = await fetch('/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-derby-pin': getPin() },
    body: JSON.stringify({ name, args }),
  });
  const body = (await res.json()) as { ok: boolean; result?: T; error?: string; code?: string };
  if (!body.ok) throw new CommandError(body.error ?? 'Command failed.', body.code ?? 'unknown');
  return body.result as T;
}

export async function fetchInfo(): Promise<ServerInfo> {
  const res = await fetch('/api/info');
  return (await res.json()) as ServerInfo;
}

export async function fetchDiagnostics(): Promise<Diagnostics> {
  const res = await fetch('/api/diagnostics');
  return (await res.json()) as Diagnostics;
}

export interface ImportResult {
  id: string;
  name: string;
  replaced: boolean;
  media: number;
}

/** POST a file or blob as the raw request body (photos, clips, event zips) and return the result field. */
export async function postBlob<T = unknown>(url: string, blob: Blob, contentType = blob.type): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-derby-pin': getPin() },
    body: blob,
  });
  const body = (await res.json()) as { ok: boolean; result?: T; error?: string; code?: string };
  if (!body.ok) throw new CommandError(body.error ?? 'Upload failed.', body.code ?? 'unknown');
  return body.result as T;
}

/** Upload an event export zip. */
export function importEvent(file: File, mode: 'copy' | 'replace'): Promise<ImportResult> {
  return postBlob<ImportResult>(`/api/import?mode=${mode}`, file, 'application/zip');
}

export async function fetchHistory(): Promise<HistoryEntry[]> {
  const res = await fetch('/api/history');
  return (await res.json()) as HistoryEntry[];
}

export interface Connection {
  close(): void;
}

/** Open the live feed, reconnecting with backoff until closed. */
export function openConnection(
  onMessage: (message: ServerMessage) => void,
  onConnected: (connected: boolean) => void,
): Connection {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${location.host}/ws`);
    socket.onopen = () => {
      attempt = 0;
      onConnected(true);
      // Tell the server which page this is and whether cameras can work here,
      // so the setup wizard can verify screens and phones.
      try {
        socket?.send(
          JSON.stringify({
            type: 'hello',
            page: location.pathname.split('/')[1] || 'home',
            secure: window.isSecureContext,
            camera: !!navigator.mediaDevices?.getUserMedia,
          }),
        );
      } catch {
        /* ignore */
      }
    };
    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data as string) as ServerMessage);
      } catch {
        /* ignore malformed */
      }
    };
    socket.onclose = () => {
      onConnected(false);
      if (closed) return;
      attempt += 1;
      timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** attempt));
    };
    socket.onerror = () => socket?.close();
  };
  connect();

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    },
  };
}
