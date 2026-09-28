// Line icons (24 × 24, 2 px strokes), drawn here so the editor depends on no icon package. Decorative by default:
// the button or link that holds one carries the accessible name.
const PATHS = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  key: 'M15 7a4 4 0 1 1-3.9 5H9v2H7v2H4v-3l6.1-6.1A4 4 0 0 1 15 7zm1 2.5h.01',
  users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 9v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  monitor: 'M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 20h8M12 16v4',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
  back: 'M19 12H5M12 19l-7-7 7-7',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9zM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6z',
  film: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4',
  brush: 'M18.4 2.6a2 2 0 0 1 3 3L12 15l-3-3zM9 12l3 3-1.5 1.5A4 4 0 0 1 4 21H3v-1a4 4 0 0 1 4.5-6.5z',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  mic: 'M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  scene: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 15l5-5 4 4 3-3 6 6',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  up: 'M18 15l-6-6-6 6',
  down: 'M6 9l6 6 6-6',
  chevron: 'M9 18l6-6-6-6',
  cast: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8v6M23 11h-6',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h.01M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5',
  subtitles: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM6 14h4M13 14h5M6 10h8M16 10h2',
  volume: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  mute: 'M11 5L6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.3l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  remix: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  tag: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  home: 'M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  trending: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  copy: 'M9 9h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  keyboard: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4M7 16h10',
  alert: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  card: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM2 10h20M6 15h4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  flag: 'M4 22V4M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1',
  gauge: 'M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0',
  lock: 'M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4',
  ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.93 4.93l14.14 14.14',
} as const;
export type IconName = keyof typeof PATHS;
const FILLED = new Set<IconName>(['play', 'pause']);
/** filled when « on » (a liked heart) */
export const filledIcon = (name: IconName) => FILLED.has(name);

export function Icon({ name, size = 18, className, title, filled }: { name: IconName; size?: number; className?: string; title?: string; filled?: boolean }) {
  return (
    <svg className={`icon-svg${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill={filled || FILLED.has(name) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title} focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
