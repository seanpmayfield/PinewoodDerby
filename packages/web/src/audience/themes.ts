/** The looks the audience screen can take. Broadcast is the base look in audience.css; the others override it in themes.css under `[data-theme=...]`. */
interface ThemeInfo {
  id: string;
  name: string;
  blurb: string;
}

export const DEFAULT_THEME = 'cartoon';

export const THEMES: ThemeInfo[] = [
  { id: 'cartoon', name: 'Cartoon', blurb: 'Bright sky blue, chunky white cards with thick outlines, big rounded type. Made for the scouts.' },
  { id: 'broadcast', name: 'Broadcast', blurb: 'Black scoreboard, condensed type, lane colors and gold. Sports-TV feel.' },
  { id: 'dragstrip', name: 'Drag strip', blurb: 'Checkered flags, warm chrome and red, neon glow on the lights. Classic speed shop.' },
  { id: 'minimal', name: 'Minimal', blurb: 'White background, one orange accent, lots of space. Reads well on a weak projector in a bright room.' },
];
