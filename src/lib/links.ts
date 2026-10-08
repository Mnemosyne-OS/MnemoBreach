/**
 * links.ts — external pages the cartridge offers, opened in the OS browser.
 *
 * A sandboxed cartridge has no popups, so `target="_blank"` is dead here; the
 * ungated host action `shell.openExternal` opens the page, and answers
 * `{ success, error? }`, read so a page that did not open is SAID (doc 119).
 */
import { sdk } from './profile';

/** The free, manual half of the email search (doc 141 §20): HIBP's own site. */
export const HIBP_SEARCH_PAGE = 'https://haveibeenpwned.com/';
/** HIBP's free alert: it writes to the person when their address appears in a new breach. */
export const HIBP_NOTIFY_PAGE = 'https://haveibeenpwned.com/NotifyMe';
/** Where HIBP sells the key that unlocks the day-precise search. */
export const HIBP_KEY_PAGE = 'https://haveibeenpwned.com/API/Key';

type Invoke = <T>(action: string, payload?: unknown) => Promise<T>;
let invoke: Invoke = (action, payload) => sdk.invoke(action, payload, 15_000);

/** Tests only. */
export function __setLinksInvokeForTests(fn: Invoke): void {
  invoke = fn;
}

/** True when the host says the page opened. */
export async function openLink(url: string): Promise<boolean> {
  try {
    const res = await invoke<{ success?: boolean; error?: string } | undefined>('shell.openExternal', { url });
    // An answer with no verdict is unknown, not a failure (doc 119 §9).
    if (res && res.success === false) {
      console.warn('[breach] link did not open:', res.error ?? 'refused');
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[breach] link did not open:', err instanceof Error ? err.message : String(err));
    return false;
  }
}
