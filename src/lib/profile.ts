/**
 * profile.ts — the person's OWN identifiers, declared once (doc 141 §5).
 *
 * There is no free search field anywhere in this cartridge: every lookup in
 * lot 2 will start from a line of this profile. That is what keeps it from
 * becoming a tool to look someone else up.
 *
 * Held in the host's durable state (doc 73), outside any vault. Re-normalised
 * on EVERY read: a hand-edited or older blob never reaches the screen as-is.
 * In lot 1 the profile is only saved and shown masked; nothing is sent.
 */
import { MnemoCartridgeSDK } from '../sdk/mnemo-sdk';
import { isEmail, normalizePhone } from './mask';
import { forgetEmail, normalizeFindings, type Findings } from './findings';

/** Must match "name" in mnemo-plugin.json: the host keys the state on it. */
export const PLUGIN_ID = '@mnemosyne-plugins/mnemo-breach';
export const MAX_PER_KIND = 10;
const BROWSER_KEY = 'mnemo-breach:profile';
const HOST_TIMEOUT_MS = 15_000;

export interface Profile {
  emails: string[];
  phones: string[];
  /**
   * The chronicle written for each email (lot 2), so "remember" replaces the
   * previous one and "forget" can take all of them back. Keyed by the email:
   * this blob lives in the host's state on this machine, never in a vault.
   */
  memory: Record<string, number>;
  /**
   * The person opened the email door once. Every host permission is asked at
   * its first call, so the account card waits for this gesture before calling
   * the host at all: opening the window never raises a dialog by itself.
   */
  doorOpened: boolean;
  /** The breaches that concern this person, found or declared (lot 3). */
  findings: Findings;
  /** Breach names seen at the last "mark as seen" (lot 4). Empty = never. */
  knownBreaches: string[];
  /** When that was, or null. */
  knownAt: string | null;
  /** The background watch was turned on by the person (lot 4). */
  watchOn: boolean;
  /** The set of services it was registered with, to re-register on change. */
  watchSig: string;
}

export const EMPTY_PROFILE: Profile = {
  emails: [], phones: [], memory: {}, doorOpened: false, findings: {},
  knownBreaches: [], knownAt: null, watchOn: false, watchSig: '',
};

export const sdk = new MnemoCartridgeSDK(PLUGIN_ID);

/** True inside the shell. Standalone in a browser (dev) the profile lives in
 *  that browser's localStorage, and the screen says so. */
export function hasHost(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

function uniq(list: string[]): string[] {
  return [...new Set(list)].slice(0, MAX_PER_KIND);
}

export function normalizeProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PROFILE, memory: {}, findings: {}, knownBreaches: [] };
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const memory: Record<string, number> = {};
  if (r.memory && typeof r.memory === 'object' && !Array.isArray(r.memory)) {
    for (const [k, v] of Object.entries(r.memory as Record<string, unknown>)) {
      if (Number.isInteger(v) && (v as number) > 0) memory[k] = v as number;
    }
  }
  return {
    emails: uniq(strings(r.emails).map((e) => e.trim().toLowerCase()).filter(isEmail)),
    phones: uniq(strings(r.phones).map(normalizePhone).filter((p): p is string => p !== null)),
    memory,
    doorOpened: r.doorOpened === true,
    findings: normalizeFindings(r.findings),
    knownBreaches: [...new Set(strings(r.knownBreaches))].slice(0, 5000),
    knownAt: typeof r.knownAt === 'string' && !Number.isNaN(Date.parse(r.knownAt)) ? r.knownAt : null,
    watchOn: r.watchOn === true,
    watchSig: typeof r.watchSig === 'string' ? r.watchSig : '',
  };
}

/** Adds one identifier. Returns the new profile, or an error code. */
export function addIdentifier(
  profile: Profile,
  value: string,
): { ok: true; profile: Profile } | { ok: false; code: 'INVALID' | 'DUPLICATE' | 'FULL' } {
  const v = value.trim();
  if (isEmail(v)) {
    const e = v.toLowerCase();
    if (profile.emails.includes(e)) return { ok: false, code: 'DUPLICATE' };
    if (profile.emails.length >= MAX_PER_KIND) return { ok: false, code: 'FULL' };
    return { ok: true, profile: { ...profile, emails: [...profile.emails, e] } };
  }
  const p = normalizePhone(v);
  if (!p) return { ok: false, code: 'INVALID' };
  if (profile.phones.includes(p)) return { ok: false, code: 'DUPLICATE' };
  if (profile.phones.length >= MAX_PER_KIND) return { ok: false, code: 'FULL' };
  return { ok: true, profile: { ...profile, phones: [...profile.phones, p] } };
}

/** Removing an email also takes it out of every finding (lot 3). */
export function removeIdentifier(profile: Profile, value: string): Profile {
  return {
    ...profile,
    findings: forgetEmail(profile.findings, value),
    emails: profile.emails.filter((e) => e !== value),
    phones: profile.phones.filter((p) => p !== value),
  };
}

/** The host answers an envelope `{ state, updatedAt }`; an empty store is null. */
export function stateOf(answer: unknown): unknown {
  if (!answer || typeof answer !== 'object') return null;
  return 'state' in answer ? answer.state : null;
}

export async function loadProfile(): Promise<Profile> {
  if (hasHost()) return normalizeProfile(stateOf(await sdk.invoke<unknown>('state.get', undefined, HOST_TIMEOUT_MS)));
  try {
    const raw = window.localStorage.getItem(BROWSER_KEY);
    return normalizeProfile(raw ? JSON.parse(raw) : null);
  } catch (err) {
    console.warn('[breach] browser profile unreadable:', err instanceof Error ? err.message : String(err));
    return { ...EMPTY_PROFILE, memory: {}, findings: {}, knownBreaches: [] };
  }
}

export async function saveProfile(profile: Profile): Promise<void> {
  if (hasHost()) {
    await sdk.invoke('state.set', { state: profile }, HOST_TIMEOUT_MS);
    return;
  }
  window.localStorage.setItem(BROWSER_KEY, JSON.stringify(profile));
}
