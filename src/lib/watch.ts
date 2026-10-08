/**
 * watch.ts — the cartridge's side of the host's background watch (doc 72).
 *
 * Under `watch:background`, asked at the first call: nothing here runs before
 * the person turns the watch on. The host reads each target once a day even
 * with this window closed, notifies, and keeps what it found in an inbox.
 */
import { sdk } from './profile';
import type { WatchPlan } from './news';

const CALL_MS = 20_000;

export interface WatchItem {
  id: string;
  label: string | null;
  /** The target url that produced it (one per domain). */
  source: string;
  at: string;
}

export interface WatchStatus {
  registered: boolean;
  lastRunAt: string | null;
  lastError: string | null;
}

type Invoke = <T>(action: string, payload?: unknown) => Promise<T>;
let invoke: Invoke = (action, payload) => sdk.invoke(action, payload, CALL_MS);

/** Tests only. */
export function __setWatchInvokeForTests(fn: Invoke): void {
  invoke = fn;
}

/** Registers (or replaces) this cartridge's targets with the host, notifications on. */
export async function registerWatch(plan: WatchPlan, intervalMin: number): Promise<void> {
  await invoke('watch.register', { targets: plan.targets, intervalMin, notify: true });
}

/** Removes every target of this cartridge from the host's watch. */
export async function unregisterWatch(): Promise<void> {
  await invoke('watch.unregister');
}

/** The inbox and why it is what it is. Unreadable rows are dropped. */
export async function readInbox(): Promise<{ items: WatchItem[]; status: WatchStatus | null }> {
  const raw = await invoke<{ items?: unknown; status?: unknown }>('watch.inbox');
  const items = (Array.isArray(raw?.items) ? raw.items : [])
    .map((r): WatchItem | null => {
      const o = (r ?? {}) as Record<string, unknown>;
      if (typeof o.id !== 'string' || typeof o.source !== 'string' || typeof o.at !== 'string') return null;
      return { id: o.id, label: typeof o.label === 'string' ? o.label : null, source: o.source, at: o.at };
    })
    .filter((x): x is WatchItem => x !== null);
  const s = raw?.status as Record<string, unknown> | null | undefined;
  const status = s && typeof s === 'object'
    ? {
        registered: s.registered === true,
        lastRunAt: typeof s.lastRunAt === 'string' ? s.lastRunAt : null,
        lastError: typeof s.lastError === 'string' ? s.lastError : null,
      }
    : null;
  return { items, status };
}

/** Empties these items from the host's inbox, once they were shown. */
export async function clearInbox(ids: string[]): Promise<void> {
  await invoke('watch.clearInbox', { ids });
}
