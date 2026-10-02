import AdmZip from 'adm-zip';
import { DerbyError, normalizeDerby, type Derby } from '@derby/core';
import type { MediaStore } from './media.js';

/**
 * One event as a single zip: the state as JSON plus every photo, replay clip,
 * headshot and logo it refers to. Used by Export, Import and the USB backup.
 */

const ARCHIVE_FORMAT = 'pinewood-derby-event';
const ARCHIVE_VERSION = 1;

export interface MediaStores {
  photos: MediaStore;
  replays: MediaStore;
  headshots: MediaStore;
  branding: MediaStore;
}

interface Manifest {
  format: string;
  version: number;
  exportedAt: string;
  event: { id: string; name: string; date: string };
  media: { photos: number; replays: number; headshots: number; branding?: number };
}

/** Storage keys the state refers to, per store. */
function mediaKeys(state: Derby): { photos: string[]; replays: string[]; headshots: string[]; branding: string[] } {
  const photos = new Set<string>();
  for (const car of state.cars) {
    const shot = car.photo?.side;
    if (shot) for (const key of [shot.original, shot.crop, shot.cutout]) if (key) photos.add(key);
  }
  const replays = new Set<string>();
  for (const round of state.rounds) for (const heat of round.heats) if (heat.replay) replays.add(heat.replay);
  const headshots = new Set<string>();
  for (const racer of state.racers) if (racer.headshot) headshots.add(racer.headshot);
  const branding = new Set<string>();
  if (state.branding?.logo) branding.add(state.branding.logo);
  for (const sponsor of state.branding?.sponsors ?? []) if (sponsor.image) branding.add(sponsor.image);
  return { photos: [...photos], replays: [...replays], headshots: [...headshots], branding: [...branding] };
}

/** A safe file name for the event: letters, digits and dashes. */
export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'derby';
}

export function exportEvent(state: Derby, stores: MediaStores): Buffer {
  const zip = new AdmZip();
  const keys = mediaKeys(state);
  const add = (folder: string, store: MediaStore, list: string[]): number => {
    let n = 0;
    for (const key of list) {
      if (!store.exists(key)) continue;
      zip.addLocalFile(store.pathOf(key), folder, key);
      n++;
    }
    return n;
  };
  const media = {
    photos: add('photos', stores.photos, keys.photos),
    replays: add('replays', stores.replays, keys.replays),
    headshots: add('headshots', stores.headshots, keys.headshots),
    branding: add('branding', stores.branding, keys.branding),
  };
  const manifest: Manifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    event: { id: state.id, name: state.name, date: state.date },
    media,
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile('derby.json', Buffer.from(JSON.stringify(state)));
  return zip.toBuffer();
}

export interface Imported {
  state: Derby;
  /** Media files written (files already present are left alone). */
  written: number;
}

/** Read an archive, write its media into the stores and return the state (not yet activated). */
export function importEvent(buffer: Buffer, stores: MediaStores): Imported {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new DerbyError('That file is not a zip archive.', 'bad-args');
  }
  const manifestEntry = zip.getEntry('manifest.json');
  const stateEntry = zip.getEntry('derby.json');
  if (!manifestEntry || !stateEntry) throw new DerbyError('That zip is not a Pinewood Derby event export.', 'bad-args');
  let manifest: Manifest;
  let raw: Derby;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as Manifest;
    raw = JSON.parse(stateEntry.getData().toString('utf8')) as Derby;
  } catch {
    throw new DerbyError('The export is damaged (unreadable JSON).', 'bad-args');
  }
  if (manifest.format !== ARCHIVE_FORMAT) throw new DerbyError('That zip is not a Pinewood Derby event export.', 'bad-args');
  if (manifest.version > ARCHIVE_VERSION) throw new DerbyError('That export comes from a newer version of the program.', 'bad-args');
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !Array.isArray(raw.cars)) {
    throw new DerbyError('The export is damaged (no event inside).', 'bad-args');
  }
  const state = normalizeDerby(raw);
  let written = 0;
  const folders: Record<string, MediaStore> = { photos: stores.photos, replays: stores.replays, headshots: stores.headshots, branding: stores.branding };
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const [folder, key, ...rest] = entry.entryName.split('/');
    const store = folder && key && rest.length === 0 ? folders[folder] : undefined;
    if (!store || !store.isValidKey(key!) || store.exists(key!)) continue;
    store.put(key!, entry.getData());
    written++;
  }
  return { state, written };
}
