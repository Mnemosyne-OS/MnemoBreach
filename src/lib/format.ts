/**
 * format.ts — dates for the screen, in the shell's language.
 * An unreadable value renders as an em dash, never as "Invalid Date".
 */

export function formatInstant(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * A breach date. HIBP often only knows the month and writes the 1st (178 of
 * 1 042 on 07/10, against ~35 expected by chance) with no precision flag, so a
 * date on the 1st is shown at the month: "March 2015", never a made-up day.
 */
export function formatBreachDay(day: string | null, lang: string, precision: 'day' | 'year' = 'day'): string {
  if (!day) return '—';
  // Known at the year only (XposedOrNot): the year alone, nothing finer.
  if (precision === 'year') return /^\d{4}/.test(day) ? day.slice(0, 4) : '—';
  if (!day.endsWith('-01')) return formatDay(day, lang);
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** A `YYYY-MM-DD` day, shown as a date with no time and no timezone shift. */
export function formatDay(day: string | null, lang: string): string {
  if (!day) return '—';
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(lang, { dateStyle: 'medium', timeZone: 'UTC' });
}
