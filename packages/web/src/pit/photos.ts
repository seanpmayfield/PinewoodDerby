import { postBlob } from '../lib/connection.ts';

const ORIGINAL_MAX_EDGE = 2048;

/**
 * Load a File into an image element (browsers apply EXIF rotation for us).
 * The object URL stays valid so the crop editor can display the image; call
 * `releaseImage` when done with it.
 */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

export function releaseImage(img: HTMLImageElement | null): void {
  if (img?.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
}

function toBlob(canvas: HTMLCanvasElement, quality: number, type = 'image/jpeg'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image.'))), type, quality);
  });
}

/** Downscale the full photo so a 12 MP upload does not clog the hotspot. */
export async function encodeOriginal(img: HTMLImageElement): Promise<Blob> {
  const scale = Math.min(1, ORIGINAL_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return toBlob(canvas, 0.85);
}

export interface CropRect {
  /** Source rectangle in image pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** The standardised crop at the side frame's output size, on white. */
export async function encodeCrop(img: HTMLImageElement, crop: CropRect, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
  return toBlob(canvas, 0.9);
}

export async function uploadPhoto(carId: string, kind: 'original' | 'crop' | 'cutout', blob: Blob): Promise<string> {
  const result = await postBlob<{ key: string }>(`/api/photos/${carId}?kind=${kind}`, blob, blob.type || 'image/jpeg');
  return result.key;
}

export function photoUrl(key: string | undefined): string | null {
  return key ? `/api/photos/${key}` : null;
}
