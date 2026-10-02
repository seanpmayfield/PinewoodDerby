import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** QR code for a URL, rendered offline. */
export function QrCode({ value, size = 160 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={`QR code for ${value}`} /> : null;
}
