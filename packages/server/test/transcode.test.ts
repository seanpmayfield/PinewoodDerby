import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findFfmpeg, probeDuration, transcodeToMp4 } from '../src/transcode.js';

const ffmpeg = findFfmpeg();

describe.skipIf(!ffmpeg)('transcodeToMp4', () => {
  it('turns a recorded clip into a playable H.264 MP4 with a duration', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'derby-tc-'));
    try {
      // Synthesise a 2 s WebM the way a browser might produce it.
      const src = path.join(dir, 'src.webm');
      execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-t', '2', '-c:v', 'libvpx', src], { windowsHide: true });
      const out = await transcodeToMp4(readFileSync(src), 'webm');
      expect(out.ext).toBe('mp4');
      expect(out.buffer.length).toBeGreaterThan(1000);
      // MP4 signature: "ftyp" at byte 4.
      expect(out.buffer.subarray(4, 8).toString('ascii')).toBe('ftyp');
      const outFile = path.join(dir, 'out.mp4');
      writeFileSync(outFile, out.buffer);
      const seconds = await probeDuration(ffmpeg!, outFile);
      expect(seconds).toBeGreaterThan(1.5);
      expect(seconds).toBeLessThan(2.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects garbage input', async () => {
    await expect(transcodeToMp4(Buffer.from('not a video'), 'mp4')).rejects.toThrow();
  }, 30_000);
});
