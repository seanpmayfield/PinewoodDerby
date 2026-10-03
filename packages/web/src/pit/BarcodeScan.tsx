import { useEffect, useRef, useState } from 'react';

/** True when this browser can read barcodes from the camera (Chrome and Edge on a secure page). */
export const BARCODE_SCAN_OK = typeof window !== 'undefined' && 'BarcodeDetector' in window && window.isSecureContext;

interface Detector {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}
declare const BarcodeDetector: { new (options?: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

/**
 * Full-screen camera view that reads the car tag barcode (or any code) and
 * hands the text back. An idea borrowed from DerbyNet's mobile check-in.
 */
export function BarcodeScan({ onCode, onCancel }: { onCode: (text: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (stop) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        const detector = new BarcodeDetector({ formats: ['code_128', 'qr_code', 'code_39', 'ean_13'] });
        const tick = async () => {
          if (stop) return;
          try {
            if (video.readyState >= 2) {
              const codes = await detector.detect(video);
              const hit = codes.find((c) => c.rawValue.trim());
              if (hit) {
                stop = true;
                onCode(hit.rawValue.trim());
                return;
              }
            }
          } catch {
            /* keep trying */
          }
          timer = setTimeout(tick, 250);
        };
        void tick();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <div className="cam scan">
      <div className="cam-box">
        <video ref={videoRef} autoPlay muted playsInline />
        <div className="scan-frame" />
        <div className="cam-hint">{error ? `Camera error: ${error}` : 'Point at the car tag barcode'}</div>
      </div>
      <div className="cam-bar">
        <button className="pbtn cam-side" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
