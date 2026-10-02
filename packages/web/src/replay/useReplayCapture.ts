import { useCallback, useEffect, useRef, useState } from 'react';
import { useDerby } from '../lib/derby.tsx';
import { command, postBlob } from '../lib/connection.ts';
import { CAMERA_OK } from '../lib/format.ts';

/**
 * Finish-line capture. Owns the camera, follows the timer, records each heat
 * and uploads the clip. Used by the standalone /replay page (laptop or phone
 * on a tripod) and embedded in the coordinator when the webcam is on the PC.
 *
 * Timing: recording starts `preRoll` seconds before the fastest car of the day
 * could reach the line, and ends `tail` seconds after the last car that
 * actually finishes. A DNF never extends it.
 */

/** Never record longer than this, whatever happens on the track. */
const MAX_CLIP_MS = 12_000;
/** With no times yet in the event, assume the fastest car needs about this long. */
const DEFAULT_FASTEST_SEC = 2.6;

interface LastClip {
  heatId: string | null;
  url: string;
  size: number;
  durationMs: number;
  uploaded: boolean;
  error?: string;
}

type CamState = 'ready' | 'recording' | 'no-camera' | 'off';

export interface ReplayCapture {
  secure: boolean;
  devices: MediaDeviceInfo[];
  stream: MediaStream | null;
  settings: MediaTrackSettings | null;
  error: string | null;
  camState: CamState;
  /** Heat id being recorded, null for a test clip, undefined when idle. */
  recordingHeat: string | null | undefined;
  last: LastClip | null;
  awake: boolean;
  fastestSec: number;
  preRollSec: number;
  tailSec: number;
  testRecord: () => void;
}

async function uploadReplay(heatId: string, blob: Blob): Promise<void> {
  await postBlob(`/api/replays/${heatId}`, blob, blob.type || 'video/webm');
}

export function useReplayCapture(enabled: boolean, deviceId: string): ReplayCapture {
  const { state, timer, notify } = useDerby();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [settings, setSettings] = useState<MediaTrackSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordingHeat, setRecordingHeat] = useState<string | null | undefined>(undefined);
  const [last, setLast] = useState<LastClip | null>(null);
  const [awake, setAwake] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);
  const recordingRef = useRef<string | null | undefined>(undefined);
  const pendingStart = useRef<{ heatId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const secure = CAMERA_OK;

  // Open (or release) the camera.
  useEffect(() => {
    if (!enabled || !secure) {
      setStream(null);
      setSettings(null);
      return;
    }
    let cancelled = false;
    let opened: MediaStream | null = null;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            facingMode: deviceId ? undefined : { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 60 },
          },
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        opened = s;
        setStream(s);
        setSettings(s.getVideoTracks()[0]?.getSettings() ?? null);
        setError(null);
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list.filter((d) => d.kind === 'videoinput'));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      opened?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled, deviceId, secure]);

  // Keep the screen on (phones on a tripod). Re-request whenever the page comes back.
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let lock: { release: () => Promise<void>; addEventListener: (t: string, f: () => void) => void } | null = null;
    const request = async () => {
      try {
        lock = await (navigator as unknown as { wakeLock: { request: (t: 'screen') => Promise<typeof lock> } }).wakeLock.request('screen');
        setAwake(true);
        lock?.addEventListener('release', () => setAwake(false));
      } catch {
        setAwake(false);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
      setAwake(false);
    };
  }, [enabled]);

  const clearTimers = () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (capTimer.current) clearTimeout(capTimer.current);
    stopTimer.current = null;
    capTimer.current = null;
  };

  const start = useCallback(
    (heatId: string | null) => {
      if (!stream || recorder.current) return;
      // H.264 MP4 first (Chrome 126+, Edge, Safari): it plays on every screen
      // as recorded, with proper duration. WebM is the fallback for older
      // Chrome; the optional server-side converter tidies those up.
      const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      const isMp4 = !!mime && mime.startsWith('video/mp4');
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
      const startedAt = Date.now();
      chunks.current = [];
      discard.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        clearTimers();
        recorder.current = null;
        recordingRef.current = undefined;
        setRecordingHeat(undefined);
        if (discard.current) return;
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'video/webm' });
        const clip: LastClip = { heatId, url: URL.createObjectURL(blob), size: blob.size, durationMs: Date.now() - startedAt, uploaded: false };
        if (heatId && blob.size > 0) {
          try {
            await uploadReplay(heatId, blob);
            clip.uploaded = true;
          } catch (err) {
            clip.error = err instanceof Error ? err.message : String(err);
            notify('error', `Replay upload failed: ${clip.error}`);
          }
        }
        setLast((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return clip;
        });
      };
      // MP4 recorders must write the clip in one piece: chunks produced with a
      // timeslice do not join into a playable file (the audience would see a
      // single frozen frame). WebM is fine with slices.
      if (isMp4) rec.start();
      else rec.start(250);
      recorder.current = rec;
      recordingRef.current = heatId;
      setRecordingHeat(heatId);
    },
    [stream, notify],
  );

  const scheduleStop = useCallback((tailMs: number, drop = false) => {
    const rec = recorder.current;
    if (!rec) return;
    if (drop) discard.current = true;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    const doStop = () => {
      stopTimer.current = null;
      if (rec.state === 'recording') rec.stop();
    };
    if (tailMs > 0) stopTimer.current = setTimeout(doStop, tailMs);
    else doStop();
  }, []);

  const cancelPendingStart = () => {
    if (pendingStart.current) clearTimeout(pendingStart.current.timer);
    pendingStart.current = null;
  };

  const fastestSec = (() => {
    let best = Infinity;
    for (const round of state?.rounds ?? []) {
      for (const heat of round.heats) {
        if (heat.status !== 'finished') continue;
        for (const lane of heat.result?.lanes ?? []) if (lane.timeSec !== null && lane.timeSec < best) best = lane.timeSec;
      }
    }
    return Number.isFinite(best) ? best : DEFAULT_FASTEST_SEC;
  })();
  const preRollSec = state?.presentation.replayPreRollSec ?? 1.0;
  const tailSec = state?.presentation.replayTailSec ?? 1.5;

  const camState: CamState = !enabled ? 'off' : recordingHeat !== undefined ? 'recording' : stream && !error ? 'ready' : 'no-camera';

  // Heartbeat so the coordinator knows a camera is (or is not) on duty.
  const camStateRef = useRef(camState);
  camStateRef.current = camState;
  useEffect(() => {
    if (!enabled) return;
    const ping = () => command('replayCamPing', { state: camStateRef.current }).catch(() => undefined);
    ping();
    const id = setInterval(ping, 5000);
    return () => clearInterval(id);
  }, [enabled]);
  useEffect(() => {
    if (enabled) command('replayCamPing', { state: camState }).catch(() => undefined);
  }, [camState, enabled]);

  // Follow the timer.
  const prev = useRef<{ state: string; heatId: string | null; lanes: number }>({ state: 'idle', heatId: null, lanes: 0 });
  useEffect(() => {
    if (!timer || !enabled) return;
    const p = prev.current;
    const lanesIn = timer.liveLanes.length;

    if (timer.state === 'racing' && p.state !== 'racing' && timer.heatId && !timer.testing) {
      cancelPendingStart();
      const heatId = timer.heatId;
      const delayMs = Math.max(0, (fastestSec - preRollSec) * 1000);
      pendingStart.current = {
        heatId,
        timer: setTimeout(() => {
          pendingStart.current = null;
          start(heatId);
          if (capTimer.current) clearTimeout(capTimer.current);
          capTimer.current = setTimeout(() => scheduleStop(0), MAX_CLIP_MS);
        }, delayMs),
      };
    }

    if (timer.state === 'racing' && lanesIn > p.lanes && recordingRef.current === timer.heatId && timer.liveLanes[lanesIn - 1]?.timeSec !== null) {
      scheduleStop(tailSec * 1000);
    }

    if (timer.state !== 'racing' && p.state === 'racing') {
      cancelPendingStart();
      if (recordingRef.current !== undefined) {
        const ours = recordingRef.current;
        const finishedThisHeat = timer.lastHeatId === ours || timer.heatId === ours;
        if (!finishedThisHeat) scheduleStop(0, true);
        else if (!stopTimer.current) scheduleStop(400);
      }
    }
    prev.current = { state: timer.state, heatId: timer.heatId, lanes: timer.state === 'racing' ? lanesIn : 0 };
  }, [timer, enabled, start, scheduleStop, fastestSec, preRollSec, tailSec]);

  // Stop everything if capture is switched off mid-heat.
  useEffect(() => {
    if (enabled) return;
    cancelPendingStart();
    if (recorder.current) scheduleStop(0, true);
  }, [enabled, scheduleStop]);

  const testRecord = useCallback(() => {
    start(null);
    setTimeout(() => scheduleStop(0), 4000);
  }, [start, scheduleStop]);

  return { secure, devices, stream, settings, error, camState, recordingHeat, last, awake, fastestSec, preRollSec, tailSec, testRecord };
}

/** Attach a stream to a <video> element (for previews). */
export function attachStream(el: HTMLVideoElement | null, stream: MediaStream | null): void {
  if (el && el.srcObject !== stream) el.srcObject = stream;
}

const DEVICE_KEY = 'derby.replay.device';
const EMBED_KEY = 'derby.replay.embedded';

export function loadReplayPrefs(): { deviceId: string; embedded: boolean } {
  try {
    return { deviceId: localStorage.getItem(DEVICE_KEY) ?? '', embedded: localStorage.getItem(EMBED_KEY) === '1' };
  } catch {
    return { deviceId: '', embedded: false };
  }
}

export function saveReplayPrefs(prefs: Partial<{ deviceId: string; embedded: boolean }>): void {
  try {
    if (prefs.deviceId !== undefined) localStorage.setItem(DEVICE_KEY, prefs.deviceId);
    if (prefs.embedded !== undefined) localStorage.setItem(EMBED_KEY, prefs.embedded ? '1' : '0');
  } catch {
    /* private mode */
  }
}
