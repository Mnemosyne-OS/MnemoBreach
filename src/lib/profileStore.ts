/**
 * profileStore.ts — one profile for the whole screen (identifiers + memory ids).
 *
 * The identifiers card and the account card both read it, so it lives here and
 * not in a component. Rules:
 *  - nothing is saved before the first read answered: a save before it would
 *    write an empty profile over the one on disk;
 *  - a failed save keeps the profile the screen had before, never the one it
 *    wanted, and returns false so the caller can say so;
 *  - 🚨 writes are a CHANGE applied to the profile as it is when the write
 *    runs, one after the other. Handing a finished profile in let two writes
 *    in flight (two "remember" in a row, a search and a declare) each start
 *    from a copy read before the other, and the second erased the first.
 */
import { useSyncExternalStore } from 'react';
import { EMPTY_PROFILE, loadProfile, saveProfile, type Profile } from './profile';

export type ProfileSnapshot =
  | { status: 'loading'; profile: Profile }
  | { status: 'error'; profile: Profile }
  | { status: 'ready'; profile: Profile };

let snap: ProfileSnapshot = { status: 'loading', profile: EMPTY_PROFILE };
const listeners = new Set<() => void>();
let started = false;

function publish(next: ProfileSnapshot): void {
  snap = next;
  listeners.forEach((fn) => fn());
}

export function getProfileSnapshot(): ProfileSnapshot {
  return snap;
}

/** Reads the saved profile once per session. */
export function startProfile(): void {
  if (started) return;
  started = true;
  loadProfile()
    .then((profile) => publish({ status: 'ready', profile }))
    .catch((err: unknown) => {
      console.warn('[breach] profile load failed:', err instanceof Error ? err.message : String(err));
      publish({ status: 'error', profile: EMPTY_PROFILE });
    });
}

/** The writes in flight, run strictly one after the other. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Applies `change` to the profile as it is when this write's turn comes, then
 * saves. False when refused or before the first read.
 */
export function updateProfile(change: (current: Profile) => Profile): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    if (snap.status !== 'ready') return false;
    const next = change(snap.profile);
    try {
      await saveProfile(next);
      publish({ status: 'ready', profile: next });
      return true;
    } catch (err) {
      console.warn('[breach] profile save failed:', err instanceof Error ? err.message : String(err));
      return false;
    }
  };
  const p = queue.then(run, run);
  queue = p;
  return p;
}

export function useProfile(): ProfileSnapshot {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, getProfileSnapshot);
}

/** Tests only. */
export function __resetProfileStoreForTests(next: ProfileSnapshot = { status: 'loading', profile: EMPTY_PROFILE }): void {
  started = false;
  snap = next;
  queue = Promise.resolve();
}
