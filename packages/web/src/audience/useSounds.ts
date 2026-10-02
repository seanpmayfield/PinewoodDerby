import { useCallback, useMemo, useRef } from 'react';

/** All sound effects are synthesised with the Web Audio API, so the app needs no audio files and stays fully offline. */

type SoundName = 'attention' | 'start' | 'lane' | 'win' | 'result' | 'fanfare' | 'reveal' | 'spotlight' | 'light' | 'go';

type Note = { f: number; t: number; d: number; g?: number; type?: OscillatorType };

const SEQUENCES: Record<SoundName, Note[]> = {
  // "Now staging": a loud two-tone PA chime, twice, to cut through a gym.
  attention: [
    { f: 1046, t: 0, d: 0.25, type: 'triangle', g: 0.45 },
    { f: 784, t: 0.25, d: 0.35, type: 'triangle', g: 0.45 },
    { f: 1046, t: 0.75, d: 0.25, type: 'triangle', g: 0.45 },
    { f: 784, t: 1.0, d: 0.45, type: 'triangle', g: 0.45 },
  ],
  // Race start lights: three short, one long a fifth up.
  start: [
    { f: 440, t: 0, d: 0.15, type: 'square', g: 0.25 },
    { f: 440, t: 0.5, d: 0.15, type: 'square', g: 0.25 },
    { f: 440, t: 1.0, d: 0.15, type: 'square', g: 0.25 },
    { f: 660, t: 1.5, d: 0.6, type: 'square', g: 0.3 },
  ],
  lane: [{ f: 1200, t: 0, d: 0.06, type: 'triangle' }],
  // Spotlight sting: a quick rising sweep.
  spotlight: [
    { f: 392, t: 0, d: 0.12, type: 'triangle' },
    { f: 523, t: 0.1, d: 0.12, type: 'triangle' },
    { f: 784, t: 0.2, d: 0.35, type: 'triangle' },
  ],
  // One amber light on the tree.
  light: [{ f: 440, t: 0, d: 0.25, type: 'square', g: 0.28 }],
  // Green light.
  go: [{ f: 880, t: 0, d: 0.9, type: 'square', g: 0.32 }],
  win: [
    { f: 784, t: 0, d: 0.1 },
    { f: 988, t: 0.1, d: 0.1 },
    { f: 1175, t: 0.2, d: 0.1 },
    { f: 1568, t: 0.3, d: 0.4 },
  ],
  result: [
    { f: 523, t: 0, d: 0.12 },
    { f: 659, t: 0.12, d: 0.12 },
    { f: 784, t: 0.24, d: 0.3 },
  ],
  fanfare: [
    { f: 523, t: 0, d: 0.18, type: 'sawtooth', g: 0.18 },
    { f: 523, t: 0.2, d: 0.18, type: 'sawtooth', g: 0.18 },
    { f: 523, t: 0.4, d: 0.18, type: 'sawtooth', g: 0.18 },
    { f: 659, t: 0.6, d: 0.5, type: 'sawtooth', g: 0.2 },
    { f: 784, t: 1.0, d: 0.5, type: 'sawtooth', g: 0.2 },
    { f: 1047, t: 1.4, d: 1.0, type: 'sawtooth', g: 0.22 },
  ],
  reveal: [
    { f: 392, t: 0, d: 0.5, type: 'sawtooth', g: 0.15 },
    { f: 494, t: 0, d: 0.5, type: 'sawtooth', g: 0.12 },
    { f: 587, t: 0, d: 0.5, type: 'sawtooth', g: 0.12 },
    { f: 784, t: 0.45, d: 0.9, type: 'sawtooth', g: 0.2 },
  ],
};

export function useSounds(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  const unlock = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctxRef.current = new Ctor();
    }
    void ctxRef.current.resume();
  }, []);

  const play = useCallback(
    (name: SoundName) => {
      const ctx = ctxRef.current;
      if (!enabled || !ctx || ctx.state !== 'running') return;
      const master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const start = ctx.currentTime + 0.01;
      for (const note of SEQUENCES[name]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = note.type ?? 'sine';
        osc.frequency.value = note.f;
        const g = note.g ?? 0.3;
        gain.gain.setValueAtTime(0, start + note.t);
        gain.gain.linearRampToValueAtTime(g, start + note.t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, start + note.t + note.d);
        osc.connect(gain);
        gain.connect(master);
        osc.start(start + note.t);
        osc.stop(start + note.t + note.d + 0.05);
      }
    },
    [enabled],
  );

  return useMemo(() => ({ unlock, play }), [unlock, play]);
}
