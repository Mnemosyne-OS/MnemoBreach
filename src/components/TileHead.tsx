/**
 * TileHead — the head of a glass tile: a tinted icon chip, the title, and an
 * optional hint under it. Icons are inline SVG (no icon library in this
 * cartridge), decorative only: the title carries the meaning.
 */
import type { ReactNode } from 'react';

export type TileIcon = 'lock' | 'person' | 'search' | 'key' | 'timeline' | 'bell' | 'book' | 'external';

const PATHS: Record<TileIcon, ReactNode> = {
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  person: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2" /></>,
  timeline: <><path d="M3 12h18" /><circle cx="7" cy="12" r="2" /><circle cx="15" cy="12" r="2" /><path d="M7 5v5M15 14v5" /></>,
  bell: <><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  book: <><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
};

export function TileHead({ icon, title, hint, level = 2 }: { icon: TileIcon; title: string; hint?: ReactNode; level?: 2 | 3 }) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="bw-tile-head">
      <span className="bw-chip" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {PATHS[icon]}
        </svg>
      </span>
      <div className="bw-tile-titles">
        <Heading>{title}</Heading>
        {hint && <p className="bw-hint">{hint}</p>}
      </div>
    </div>
  );
}
