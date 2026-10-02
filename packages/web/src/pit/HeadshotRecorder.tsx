import { useEffect, useRef, useState } from 'react';
import { postBlob } from '../lib/connection.ts';

/** Seconds of scout on camera. Short enough to loop on the big screen. */
const HEADSHOT_SECONDS = 4;
const COUNT_IN = 3;

async function uploadHeadshot(racerId: string, blob: Blob): Promise<string> {
  return (await postBlob<{ key: string }>(`/api/headshots/${racerId}`, blob, blob.type || 'video/webm')).key;
}

/**
 * Front-camera video "headshot" of the scout: count in, record a few seconds
 * with sound, preview, upload. Plays in the racer spotlight and on awards.
 */
export function HeadshotRecorder({ racerId, racerName, onDone, onCancel }: { racerId: string; racerName: string; onDone: () => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'ready' | 'countin' | 'recording' | 'review' | 'saving'>('ready');
  const [count, setCount] = useState(COUNT_IN);
  const [remaining, setRemaining] = useState(HEADSHOT_SECONDS);
  const [clip, setClip] = useState<{ blob: Blob; url: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: MediaStream | null = null;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        opened = s;
        setStream(s);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      opened?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (videoRef.current && stream && phase !== 'review') videoRef.current.srcObject = stream;
  }, [stream, phase]);

  useEffect(() => () => {
    if (clip) URL.revokeObjectURL(clip.url);
  }, [clip]);

  const begin = () => {
    if (!stream) return;
    setPhase('countin');
    setCount(COUNT_IN);
    let n = COUNT_IN;
    const tick = setInterval(() => {
      n -= 1;
      setCount(n);
      if (n <= 0) {
        clearInterval(tick);
        record();
      }
    }, 1000);
  };

  const record = () => {
    if (!stream) return;
    // H.264 MP4 first: it plays everywhere as recorded. WebM (older Chrome) needs the optional converter.
    const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      recorder.current = null;
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
      setClip({ blob, url: URL.createObjectURL(blob) });
      setPhase('review');
    };
    // MP4 must be written in one piece; sliced MP4 chunks do not join into a playable file.
    if (mime?.startsWith('video/mp4')) rec.start();
    else rec.start(250);
    recorder.current = rec;
    setPhase('recording');
    setRemaining(HEADSHOT_SECONDS);
    let left = HEADSHOT_SECONDS;
    const tick = setInterval(() => {
      left -= 1;
      setRemaining(left);
      if (left <= 0) {
        clearInterval(tick);
        if (rec.state === 'recording') rec.stop();
      }
    }, 1000);
  };

  const save = async () => {
    if (!clip) return;
    setPhase('saving');
    try {
      await uploadHeadshot(racerId, clip.blob);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('review');
    }
  };

  const retake = () => {
    if (clip) URL.revokeObjectURL(clip.url);
    setClip(null);
    setPhase('ready');
  };

  return (
    <div className="cam headshot">
      <div className="cam-box">
        {phase === 'review' && clip ? (
          <video key={clip.url} src={clip.url} autoPlay loop playsInline controls className="headshot-review" />
        ) : (
          <video ref={videoRef} autoPlay muted playsInline className="headshot-live" />
        )}
        {phase !== 'review' && <div className="headshot-guide" />}
        {phase === 'countin' && <div className="headshot-count">{count}</div>}
        {phase === 'recording' && (
          <div className="headshot-rec">
            <span className="headshot-rec-dot" /> {remaining}
          </div>
        )}
        <div className="cam-hint">
          {error
            ? `Camera error: ${error}`
            : phase === 'ready'
              ? `${racerName}: face the camera and say hi when it counts you in`
              : phase === 'countin'
                ? 'Get ready…'
                : phase === 'recording'
                  ? 'Say hi!'
                  : phase === 'review'
                    ? 'How does it look?'
                    : 'Saving…'}
        </div>
      </div>
      <div className="cam-bar">
        {phase === 'review' ? (
          <>
            <button className="pbtn cam-side" onClick={retake}>
              Retake
            </button>
            <button className="pbtn pbtn-primary" onClick={save}>
              Use it
            </button>
            <button className="pbtn cam-side" onClick={onCancel}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="pbtn cam-side" onClick={onCancel} disabled={phase === 'saving'}>
              Cancel
            </button>
            <button className="cam-shutter is-video" onClick={begin} disabled={!stream || phase !== 'ready'} aria-label="Record">
              <span />
            </button>
            <span className="cam-side headshot-spacer">{HEADSHOT_SECONDS} s</span>
          </>
        )}
      </div>
    </div>
  );
}
