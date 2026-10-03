import type { Derby } from '@derby/core';

interface LiveLane {
  lane: number;
  timeSec: number | null;
  place: number | null;
}

interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  friendlyName?: string;
  likelyTimer: boolean;
}

/** Mirrors `TimerStatus` in the server package. */
export interface TimerStatus {
  /** 'simulator', 'auto', or a timer profile key. */
  kind: string;
  /** The timer profile in use once connected. */
  profile: { key: string; name: string } | null;
  /** The timer can open the start gate itself. */
  remoteStart: boolean;
  /** Lanes the timer reported having, if it said. */
  lanesDetected: number | null;
  connected: boolean;
  connecting: boolean;
  state: 'idle' | 'armed' | 'racing';
  identity: string | null;
  port: string | null;
  baud: number | null;
  verified: boolean;
  ports: SerialPortInfo[];
  heatId: string | null;
  testing: boolean;
  liveLanes: LiveLane[];
  missingLanes: number[];
  countdown: { startedAt: number; lights: number; intervalMs: number; stageMs: number } | null;
  replayCamAt: number | null;
  replayCamState: 'ready' | 'recording' | 'no-camera' | null;
  lastHeatId: string | null;
  lastLanes: LiveLane[];
  lastError: string | null;
  log: string[];
}

export interface UndoInfo {
  label: string;
  at: string;
}

export interface BackupStatus {
  enabled: boolean;
  supported: boolean;
  drives: string[];
  lastAt: string | null;
  lastPath: string | null;
  lastError: string | null;
  busy: boolean;
  pending: boolean;
}

export type ServerMessage =
  | { type: 'state'; state: Derby; undo?: UndoInfo | null; redo?: UndoInfo | null }
  | { type: 'backup'; backup: BackupStatus }
  | { type: 'build'; build: string }
  | { type: 'timer'; timer: TimerStatus }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string };

export interface ServerInfo {
  name: string;
  derbyId: string;
  urls: string[];
  httpsUrls: string[];
  secureAvailable: boolean;
  pinRequired: boolean;
  crewPinSet: boolean;
  timer: TimerStatus;
  derbies: { id: string; name: string; date: string; updatedAt: string }[];
  formats: { id: string; name: string; description: string }[];
  clients: number;
  wizardDone: boolean;
  backup: BackupStatus;
}

interface ClientInfo {
  page: string;
  secure: boolean;
  camera: boolean;
  tls: boolean;
  ip: string;
  userAgent: string;
  connectedAt: number;
}

export interface Diagnostics {
  addresses: string[];
  hotspot: boolean;
  port: number;
  httpsPort: number | null;
  firewallRule: boolean | null;
  ffmpeg: boolean;
  dataDir: string;
  wizardDone: boolean;
  clients: ClientInfo[];
  timer: TimerStatus;
  /** Web build stamp, Node version, OS and server uptime, for feedback reports. */
  build: string;
  node: string;
  platform: string;
  uptimeSec: number;
}

export interface HistoryEntry {
  id: number;
  createdAt: string;
  change: string;
}
