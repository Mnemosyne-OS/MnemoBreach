/**
 * account.ts — the cartridge's side of the `breach:lookup` door (doc 141 §4).
 *
 * Every call goes through the host: the HIBP account endpoint has no CORS, and
 * the key must never live in this iframe. The key is sent ONCE by `saveKey` and
 * no action can return it. The host refuses an email this cartridge did not
 * save (NOT_DECLARED), so a search can only start from the profile.
 *
 * The host rejects with the error CODE as the message; this module turns a
 * rejection back into a named state. Every call has a 20 s deadline (the host
 * has its own 15 s one on the network; this one covers the bridge).
 */
import { sdk } from './profile';
import { normalizeBreaches, type Breach } from './breaches';

const CALL_MS = 20_000;

export interface KeyState {
  present: boolean;
  savedAt: number | null;
  seal: 'sealed' | 'plaintext' | 'unknown' | 'unavailable';
}

/** Which service answered: the person's paid HIBP key, or the free XposedOrNot. */
export type SearchSource = 'hibp' | 'xon';

export type AccountResult =
  | { kind: 'found'; breaches: Breach[]; checkedAt: string; via?: SearchSource }
  | { kind: 'absent'; checkedAt: string; via?: SearchSource }
  /** `retryAfterSec`: HIBP's own wait, when it gave one. Absent, never 0. */
  | { kind: 'error'; code: string; retryAfterSec?: number };

/** The codes the screen has a sentence for; anything else is shown as FAILED. */
export const KNOWN_CODES = [
  'NO_KEY', 'KEY_REFUSED', 'USER_AGENT_REFUSED', 'RATE_LIMITED', 'TIMEOUT', 'NETWORK',
  'BAD_RESPONSE', 'NOT_DECLARED', 'EMPTY', 'HAS_WHITESPACE', 'LOOKS_LIKE_URL', 'SEAL_REFUSED',
] as const;

type Invoke = <T>(action: string, payload?: unknown) => Promise<T>;
let invoke: Invoke = (action, payload) => sdk.invoke(action, payload, CALL_MS);

/** Tests only. */
export function __setInvokeForTests(fn: Invoke): void {
  invoke = fn;
}

/** HIBP's wait carried in a rejection ("RATE_LIMITED retryAfter=3"), or undefined. */
export function retryAfterOf(err: unknown): number | undefined {
  const m = /retryAfter=(\d+)/.exec(err instanceof Error ? err.message : String(err));
  return m ? Number(m[1]) : undefined;
}

/** A rejection → a code the screen can name. Never the raw message as data. */
export function codeOf(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const known = (KNOWN_CODES as readonly string[]).find((c) => msg.includes(c));
  if (known) return known;
  // The SDK's deadline: 'Host did not reply to "x" within 20s'.
  if (/did not reply|timed? ?out/i.test(msg)) return 'TIMEOUT';
  // The bridge's refusal: 'Unauthorized: This cartridge does not have the "x" permission.'
  if (/unauthori[sz]ed|permission/i.test(msg)) return 'PERMISSION_DENIED';
  return 'FAILED';
}

function keyStateOf(raw: unknown): KeyState {
  const r = (raw ?? {}) as Partial<KeyState>;
  const seals = ['sealed', 'plaintext', 'unknown', 'unavailable'] as const;
  return {
    present: r.present === true,
    savedAt: typeof r.savedAt === 'number' && r.savedAt > 0 ? r.savedAt : null,
    seal: seals.includes(r.seal as KeyState['seal']) ? (r.seal as KeyState['seal']) : 'unknown',
  };
}

/** Whether the person's HIBP key is stored, when and how it is sealed. Never the key. */
export async function readKeyState(): Promise<KeyState> {
  return keyStateOf(await invoke('breach.keyState'));
}

/** Sends the key once to the host, which seals it. `warning` = an unusual shape, saved anyway. */
export async function saveKey(key: string): Promise<{ state: KeyState; warning: boolean }> {
  const raw = await invoke<{ warning?: string }>('breach.setKey', { key });
  return { state: keyStateOf(raw), warning: raw?.warning === 'UNEXPECTED_SHAPE' };
}

/** Deletes the sealed key file on the host. */
export async function removeKey(): Promise<KeyState> {
  return keyStateOf(await invoke('breach.removeKey'));
}

/** One saved email searched through the host door. Never throws: a refusal is a named error result. */
export async function lookup(email: string): Promise<AccountResult> {
  try {
    const raw = await invoke<{ kind?: unknown; breaches?: unknown; checkedAt?: unknown }>('breach.lookup', { account: email });
    const checkedAt = typeof raw?.checkedAt === 'string' ? raw.checkedAt : null;
    if (raw?.kind === 'absent' && checkedAt) return { kind: 'absent', checkedAt, via: 'hibp' };
    if (raw?.kind === 'found' && checkedAt) {
      const breaches = normalizeBreaches(raw.breaches);
      if (breaches) return { kind: 'found', breaches, checkedAt, via: 'hibp' };
    }
    return { kind: 'error', code: 'BAD_RESPONSE' };
  } catch (err) {
    // The code only: the message could carry nothing personal, but the habit
    // of never logging a lookup is what keeps it that way.
    const code = codeOf(err);
    console.warn('[breach] lookup refused:', code);
    const wait = retryAfterOf(err);
    return wait === undefined ? { kind: 'error', code } : { kind: 'error', code, retryAfterSec: wait };
  }
}
