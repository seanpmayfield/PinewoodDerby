import type { Car, Derby, Group, Heat, Racer, ScoringMethod } from '@derby/core';

/** Live camera needs a secure page (https or localhost) and a browser that exposes getUserMedia. */
export const CAMERA_OK = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

interface CarImage {
  url: string;
  cutout: boolean;
}

/** The car's side picture: the background-removed cutout if there is one, else the crop; null without a photo. */
export function carImage(car: Car, wantCutout = true): CarImage | null {
  const shot = car.photo?.side;
  if (!shot) return null;
  if (wantCutout && shot.cutout) return { url: `/api/photos/${shot.cutout}`, cutout: true };
  if (shot.crop) return { url: `/api/photos/${shot.crop}`, cutout: false };
  return null;
}

export interface CarInfo {
  car: Car;
  racer: Racer | undefined;
  group: Group | undefined;
  number: number;
  racerName: string;
  groupName: string;
  carName: string;
}

/** Cars that can be on the track: not withdrawn, racer checked in (or no racer record). */
export function checkedInCars(state: Derby): CarInfo[] {
  return state.cars
    .filter((c) => !c.withdrawn)
    .map((c) => carInfo(state, c.id))
    .filter((i): i is CarInfo => !!i && i.racer?.checkedIn !== false);
}

/** Column heading for a round's score: short for tight tables, long for print. */
export function scoringLabel(scoring: ScoringMethod, style: 'short' | 'long' = 'short'): string {
  switch (scoring.kind) {
    case 'average-time':
      return style === 'short' ? 'Avg' : 'Average time';
    case 'total-time':
      return style === 'short' ? 'Total' : 'Total time';
    case 'best-time':
      return style === 'short' ? 'Best' : 'Best time';
    case 'points':
      return 'Points';
    case 'wins':
      return 'Wins';
  }
}

/** The event date for people ("Saturday, January 23, 2027"); '' when unset, the raw text when unreadable. */
export function fmtEventDate(iso: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'long' }): string {
  if (!iso) return '';
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, options);
}

export function carInfo(state: Derby, carId: string): CarInfo | null {
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return null;
  const racer = state.racers.find((r) => r.id === car.racerId);
  const groupId = car.groupId ?? racer?.groupId;
  const group = state.groups.find((g) => g.id === groupId);
  return {
    car,
    racer,
    group,
    number: car.number,
    racerName: racer ? `${racer.firstName} ${racer.lastName}`.trim() : 'Unknown',
    groupName: group?.name ?? '',
    carName: car.name ?? '',
  };
}

export function fmtTime(t: number | null | undefined): string {
  return t === null || t === undefined ? '—' : t.toFixed(4);
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const LANE_COLORS = ['#e5484d', '#3e8bff', '#30a46c', '#f5b301', '#a855f7', '#f97316', '#06b6d4', '#ec4899'];

export function laneColor(lane: number): string {
  return LANE_COLORS[(lane - 1) % LANE_COLORS.length]!;
}

export function heatStatusLabel(heat: Heat): string {
  switch (heat.status) {
    case 'pending':
      return 'Up next';
    case 'staged':
      return 'Armed';
    case 'running':
      return 'Racing';
    case 'finished':
      return 'Done';
    case 'voided':
      return 'Voided';
  }
}

export function groupPath(state: Derby, groupId: string | null): string {
  if (!groupId) return 'Whole pack';
  return state.groups.find((g) => g.id === groupId)?.name ?? '';
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}
