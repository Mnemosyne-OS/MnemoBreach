/**
 * catalogueStore.ts — the public breach list, read once per session and shared.
 *
 * The catalogue card lists it and the news card diffs it, so it is fetched
 * once here rather than twice (1.1 MB). Kept in memory only: the durable state
 * refuses past 256 KB, and the list is public anyway.
 */
import { useSyncExternalStore } from 'react';
import { fetchCatalogue, type CatalogueResult } from './breaches';

export type CatalogueSnapshot = { kind: 'loading' } | CatalogueResult;

let snap: CatalogueSnapshot = { kind: 'loading' };
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: CatalogueSnapshot): void {
  snap = next;
  listeners.forEach((fn) => fn());
}

/** Reads the catalogue unless a read is already running. `force` re-reads. */
export function loadCatalogue(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && snap.kind === 'ok') return Promise.resolve();
  publish({ kind: 'loading' });
  inFlight = fetchCatalogue()
    .then((r) => publish(r))
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function useCatalogue(): CatalogueSnapshot {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => snap);
}

/** Tests only. */
export function __resetCatalogueForTests(): void {
  snap = { kind: 'loading' };
  inFlight = null;
}
