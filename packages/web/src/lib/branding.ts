import { postBlob } from './connection.ts';

/**
 * Shrink a logo for upload. PNGs and SVGs keep transparency (an SVG is
 * rasterised, since the server stores only PNG, JPEG and WebP); anything
 * already small enough and in a stored format is sent as it is.
 */
export async function shrinkImage(file: File, maxEdge = 1400): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not an image the browser can read.'));
      i.src = url;
    });
    const svg = file.type === 'image/svg+xml';
    const stored = file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp';
    const scale = svg ? maxEdge / Math.max(img.naturalWidth, img.naturalHeight) : Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && stored) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const jpeg = file.type === 'image/jpeg';
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert the image.'))), jpeg ? 'image/jpeg' : 'image/png', 0.9));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const uploadLogo = (blob: Blob) => postBlob<{ key: string }>('/api/branding/logo', blob, blob.type);
export const uploadSponsorImage = (sponsorId: string, blob: Blob) => postBlob<{ key: string }>(`/api/branding/sponsors/${sponsorId}`, blob, blob.type);
export const brandingUrl = (key: string) => `/api/branding/${key}`;
