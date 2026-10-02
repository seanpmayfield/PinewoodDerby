import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const VIDEO_TYPES: Record<string, string> = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
};

/**
 * Media files (car photos, replay clips, scout headshots, logos) live on disk next
 * to the database; the state only holds their keys. Keys are generated here
 * so a request can never name an arbitrary file.
 */
export class MediaStore {
  constructor(
    private readonly dir: string,
    private readonly types: Record<string, string>,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  extensionFor(contentType: string | undefined): string | null {
    if (!contentType) return null;
    return this.types[contentType.split(';')[0]!.trim().toLowerCase()] ?? null;
  }

  save(buffer: Buffer, ext: string): string {
    const key = `${randomUUID()}.${ext}`;
    writeFileSync(path.join(this.dir, key), buffer);
    return key;
  }

  isValidKey(key: string): boolean {
    return /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(key) && Object.values(this.types).includes(key.split('.').pop()!);
  }

  contentType(key: string): string {
    const ext = key.split('.').pop();
    return Object.entries(this.types).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
  }

  exists(key: string): boolean {
    return this.isValidKey(key) && existsSync(path.join(this.dir, key));
  }

  size(key: string): number {
    return statSync(path.join(this.dir, key)).size;
  }

  stream(key: string) {
    return createReadStream(path.join(this.dir, key));
  }

  remove(key: string): void {
    if (this.exists(key)) unlinkSync(path.join(this.dir, key));
  }

  pathOf(key: string): string {
    if (!this.isValidKey(key)) throw new Error('Bad media key.');
    return path.join(this.dir, key);
  }

  /** Write a file under a key that already exists elsewhere (import, restore). */
  put(key: string, buffer: Buffer): void {
    writeFileSync(this.pathOf(key), buffer);
  }
}

export class PhotoStore extends MediaStore {
  constructor(dir: string) {
    super(dir, IMAGE_TYPES);
  }
}

export class ReplayStore extends MediaStore {
  constructor(dir: string) {
    super(dir, VIDEO_TYPES);
  }
}

/** The pack logo and sponsor logos. */
export class BrandingStore extends MediaStore {
  constructor(dir: string) {
    super(dir, IMAGE_TYPES);
  }
}

/** Short video headshots of the scouts. */
export class HeadshotStore extends MediaStore {
  constructor(dir: string) {
    super(dir, VIDEO_TYPES);
  }
}
