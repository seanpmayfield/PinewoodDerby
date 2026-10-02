import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DerbyEngine, type Derby } from '@derby/core';
import { command as sendCommand, openConnection } from './connection.ts';
import type { BackupStatus, ServerMessage, TimerStatus, UndoInfo } from './types.ts';
import { recordEvent } from './errors.ts';

export interface Notice {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

interface DerbyContextValue {
  state: Derby | null;
  /** Read-only engine over the current state for lookups (standings, current heat...). Never mutate. */
  view: DerbyEngine | null;
  timer: TimerStatus | null;
  /** What the Undo button would revert, or null. */
  undo: UndoInfo | null;
  /** What Redo would re-apply, or null. */
  redo: UndoInfo | null;
  /** USB backup state, pushed by the server. */
  backup: BackupStatus | null;
  connected: boolean;
  notices: Notice[];
  notify: (level: Notice['level'], message: string) => void;
  dismiss: (id: number) => void;
  /** Send a command; errors become notices and the promise resolves to undefined. */
  run: <T = unknown>(name: string, args?: unknown) => Promise<T | undefined>;
}

const DerbyContext = createContext<DerbyContextValue | null>(null);

export function DerbyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Derby | null>(null);
  const [timer, setTimer] = useState<TimerStatus | null>(null);
  const [undo, setUndo] = useState<UndoInfo | null>(null);
  const [redo, setRedo] = useState<UndoInfo | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(1);
  const loadedBuild = useRef<string | null>(null);

  const dismiss = useCallback((id: number) => setNotices((list) => list.filter((n) => n.id !== id)), []);

  const notify = useCallback(
    (level: Notice['level'], message: string) => {
      const id = nextId.current++;
      if (level !== 'info') recordEvent(level, message);
      setNotices((list) => [...list.slice(-4), { id, level, message }]);
      setTimeout(() => dismiss(id), level === 'error' ? 9000 : 5000);
    },
    [dismiss],
  );

  useEffect(() => {
    const connection = openConnection((message: ServerMessage) => {
      if (message.type === 'state') {
        setState(message.state);
        setUndo(message.undo ?? null);
        setRedo(message.redo ?? null);
      }
      else if (message.type === 'timer') setTimer(message.timer);
      else if (message.type === 'backup') setBackup(message.backup);
      else if (message.type === 'build') {
        // First message after loading tells us which build we are; a different one later means reload.
        if (loadedBuild.current === null) loadedBuild.current = message.build;
        else if (message.build !== loadedBuild.current) window.location.reload();
      }
      else notify(message.level, message.message);
    }, setConnected);
    return () => connection.close();
  }, [notify]);

  const run = useCallback(
    async <T,>(name: string, args?: unknown): Promise<T | undefined> => {
      try {
        return await sendCommand<T>(name, args);
      } catch (err) {
        notify('error', err instanceof Error ? err.message : String(err));
        return undefined;
      }
    },
    [notify],
  );

  const view = useMemo(() => (state ? new DerbyEngine(state) : null), [state]);

  const value = useMemo<DerbyContextValue>(
    () => ({ state, view, timer, undo, redo, backup, connected, notices, notify, dismiss, run }),
    [state, view, timer, undo, redo, backup, connected, notices, notify, dismiss, run],
  );

  return <DerbyContext.Provider value={value}>{children}</DerbyContext.Provider>;
}

export function useDerby(): DerbyContextValue {
  const value = useContext(DerbyContext);
  if (!value) throw new Error('useDerby must be used inside DerbyProvider');
  return value;
}
