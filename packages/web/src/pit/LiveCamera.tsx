import { useEffect, useRef, useState } from 'react';
import { SIDE, SIDE_GUIDE, SIDE_HINT } from './geometry.ts';
import { loadImage, type CropRect } from './photos.ts';

/**
 * Live viewfinder with the side outline. The user lines the car up inside
 * the frame and taps capture; the frame region becomes the standardised
 * photo and the whole frame is kept as the original.
 *
 * Needs a secure page (HTTPS or localhost) for the browser to allow the camera.
 */
export function LiveCamera({ onCapture, onCancel }: { onCapture: (img: HTMLImageElement, crop: CropRect) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    setReady(false);
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 4096 }, height: { ideal: 2160 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
          setReady(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  const capture = async () => {
    const video = videoRef.current;
    const box = boxRef.current;
    const frame = frameRef.current;
    if (!video || !box || !frame || video.videoWidth === 0) return;
    setBusy(true);
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cw = box.clientWidth;
      const ch = box.clientHeight;
      // The video is drawn with object-fit: cover; map the frame back into video pixels.
      const scale = Math.max(cw / vw, ch / vh);
      const offX = (cw - vw * scale) / 2;
      const offY = (ch - vh * scale) / 2;
      const fr = frame.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      const crop: CropRect = {
        sx: (fr.left - br.left - offX) / scale,
        sy: (fr.top - br.top - offY) / scale,
        sw: fr.width / scale,
        sh: fr.height / scale,
      };
      const canvas = document.createElement('canvas');
      canvas.width = vw;
      canvas.height = vh;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Capture failed.'))), 'image/jpeg', 0.95));
      const img = await loadImage(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
      onCapture(img, crop);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cam">
      <div className="cam-box" ref={boxRef}>
        <video ref={videoRef} autoPlay muted playsInline />
        <div className="cam-frame" ref={frameRef} style={{ aspectRatio: `${SIDE.width} / ${SIDE.height}`, width: '92%', left: '4%' }}>
          <svg className="cam-guide" viewBox={SIDE_GUIDE.viewBox} preserveAspectRatio="none">
            {SIDE_GUIDE.paths.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </svg>
          <span className="cam-corner tl" />
          <span className="cam-corner tr" />
          <span className="cam-corner bl" />
          <span className="cam-corner br" />
        </div>
        <div className="cam-hint">
          {error ? `Camera error: ${error}` : ready ? SIDE_HINT : 'Starting camera…'}
        </div>
      </div>
      <div className="cam-bar">
        <button className="pbtn cam-side" onClick={onCancel}>
          Cancel
        </button>
        <button className="cam-shutter" onClick={capture} disabled={!ready || busy} aria-label="Take photo">
          <span />
        </button>
        <button className="pbtn cam-side" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} disabled={!ready}>
          Flip
        </button>
      </div>
    </div>
  );
}
