/**
 * Normalise recorded clips (replays, headshots) so every browser plays them.
 *
 * Browsers' MediaRecorder output is inconsistent: Chrome's WebM has no
 * duration metadata (looping and seeking misbehave), and Safari's MP4 from an
 * iPhone often shows as a single frozen frame in Chrome/Edge, or is HEVC which
 * Windows cannot decode. Running each upload through the bundled ffmpeg gives
 * a plain H.264 MP4 with proper timing, which the audience screen can loop at
 * any speed.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let ffmpegPath: string | null | undefined;

/** Path to the bundled ffmpeg, or null when it is unavailable. */
export function findFfmpeg(): string | null {
  if (ffmpegPath !== undefined) return ffmpegPath;
  try {
    const p = require('ffmpeg-static') as string | null;
    ffmpegPath = p && existsSync(p) ? p : null;
  } catch {
    ffmpegPath = null;
  }
  return ffmpegPath;
}

export interface TranscodeResult {
  buffer: Buffer;
  ext: 'mp4';
}

export interface TranscodeOptions {
  /** Keep the audio track (AAC). Replay clips drop it; headshots keep it. */
  audio?: boolean;
  /** Cut the output after this many seconds. */
  maxSeconds?: number;
}

/**
 * Convert any browser-recorded clip to H.264 MP4 (max 1280 wide). Audio is
 * dropped unless asked for. Throws when ffmpeg is missing or fails; the caller
 * decides whether to keep the original instead.
 */
export async function transcodeToMp4(input: Buffer, inputExt: string, opts: TranscodeOptions = {}): Promise<TranscodeResult> {
  const timeoutMs = 30_000;
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg is not available');
  const dir = await mkdtemp(path.join(tmpdir(), 'derby-clip-'));
  const inPath = path.join(dir, `in.${inputExt}`);
  const outPath = path.join(dir, 'out.mp4');
  try {
    await writeFile(inPath, input);
    const stderr = await run(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', inPath,
        ...(opts.maxSeconds ? ['-t', String(opts.maxSeconds)] : []),
        ...(opts.audio ? ['-c:a', 'aac', '-b:a', '96k', '-ac', '1'] : ['-an']),
        '-vf', "scale='min(1280,iw)':-2,fps=30",
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outPath,
      ],
      timeoutMs,
    );
    const buffer = await readFile(outPath);
    if (buffer.length === 0) throw new Error(`ffmpeg produced an empty file: ${stderr}`);
    return { buffer, ext: 'mp4' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`${err.message}${stderr ? `: ${stderr.trim()}` : ''}`));
      else resolve(String(stderr));
    });
  });
}

/** Duration from ffmpeg's own info output (it has no ffprobe alongside). */
export async function probeDuration(ffmpeg: string, file: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true }, (_err, _stdout, stderr) => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(stderr));
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null);
    });
  });
}
