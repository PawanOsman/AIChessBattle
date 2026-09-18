type IconName = 'play' | 'pause' | 'step' | 'flip' | 'download' | 'volume' | 'mute' | 'plus' | 'repeat' | 'chevronLeft' | 'chevronRight' | 'first' | 'last' | 'copy';

const paths: Record<IconName, React.ReactNode> = {
  play: <path d="m8 5 11 7-11 7Z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  step: <path d="m5 5 10 7-10 7ZM19 5v14" />,
  flip: <path d="M7 3 3 7l4 4M3 7h12a5 5 0 0 1 5 5M17 21l4-4-4-4M21 17H9a5 5 0 0 1-5-5" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  volume: <path d="M11 4 5 9H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />,
  mute: <path d="M11 4 5 9H2v6h3l6 5ZM16 9l6 6m0-6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  repeat: <path d="M20 7v5h-5M20 12a8 8 0 1 0-2 6" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  first: <path d="M5 5v14m13-14-8 7 8 7" />,
  last: <path d="M19 5v14M6 5l8 7-8 7" />,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
};

export function Icon({ name }: { name: IconName }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
