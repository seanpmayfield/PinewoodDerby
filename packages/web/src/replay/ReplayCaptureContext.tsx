import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { loadReplayPrefs, saveReplayPrefs, useReplayCapture, type ReplayCapture } from './useReplayCapture.ts';

interface EmbeddedReplay extends ReplayCapture {
  enabled: boolean;
  deviceId: string;
  setEnabled: (on: boolean) => void;
  setDeviceId: (id: string) => void;
}

const Ctx = createContext<EmbeddedReplay | null>(null);

/**
 * Runs the replay capture inside the coordinator when "use this computer's
 * webcam" is on, so it keeps recording no matter which tab is showing.
 */
export function ReplayCaptureProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(loadReplayPrefs);
  const capture = useReplayCapture(prefs.embedded, prefs.deviceId);
  const value = useMemo<EmbeddedReplay>(
    () => ({
      ...capture,
      enabled: prefs.embedded,
      deviceId: prefs.deviceId,
      setEnabled: (on) => {
        saveReplayPrefs({ embedded: on });
        setPrefs((p) => ({ ...p, embedded: on }));
      },
      setDeviceId: (id) => {
        saveReplayPrefs({ deviceId: id });
        setPrefs((p) => ({ ...p, deviceId: id }));
      },
    }),
    [capture, prefs],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEmbeddedReplay(): EmbeddedReplay {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEmbeddedReplay must be used inside ReplayCaptureProvider');
  return v;
}
