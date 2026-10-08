/**
 * pwned.ts — "has this password been in a known breach?", without sending it.
 *
 * Pwned Passwords k-anonymity (doc 141 §3): the password is hashed with SHA-1
 * HERE, only the first 5 hex characters leave the machine, and the server
 * answers every suffix it knows under that prefix. The match is made locally.
 *
 * Measured 2026-10-07:
 *  - the endpoint answers `Access-Control-Allow-Origin: *` and allows the
 *    `Add-Padding` header in preflight, so the iframe calls it directly and no
 *    host permission is needed;
 *  - with `Add-Padding: true` the answer carries ~130 fake rows with a count of
 *    0, so an observer cannot guess the prefix from the response size.
 *    🚨 A row with count 0 is padding: it means ABSENT, never "seen 0 times".
 *
 * The password itself is never stored, logged, or put in an error message.
 */

export const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
export const FETCH_TIMEOUT_MS = 15_000;

export type PasswordCheck =
  | { kind: 'found'; count: number }
  /** Absent from the known list at that instant. Never "safe". */
  | { kind: 'absent'; checkedAt: string }
  | { kind: 'error'; code: PasswordErrorCode };

export type PasswordErrorCode =
  | 'EMPTY'
  /** No `crypto.subtle` (not a secure context): refuse, never guess. */
  | 'NO_CRYPTO'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'BAD_RESPONSE';

/** Uppercase hex SHA-1, the form the range API uses. */
export async function sha1Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('NO_CRYPTO');
  const digest = await subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** The 5 characters that leave the machine, and the 35 that never do. */
export function splitHash(hex: string): { prefix: string; suffix: string } {
  if (!/^[0-9A-F]{40}$/.test(hex)) throw new Error('BAD_HASH');
  return { prefix: hex.slice(0, 5), suffix: hex.slice(5) };
}

/**
 * Finds `suffix` in a range answer (`SUFFIX:COUNT` per line).
 * Returns the count, or null when absent. A count of 0 is padding: null.
 * Returns undefined when the body is not a range answer at all, so the caller
 * can say "bad response" instead of reading garbage as "absent".
 */
export function countInRange(body: string, suffix: string): number | null | undefined {
  const want = suffix.toUpperCase();
  let sawRow = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([0-9A-Fa-f]{35}):(\d+)$/.exec(line);
    if (!m) return undefined;
    sawRow = true;
    if (m[1]!.toUpperCase() === want) {
      const n = Number(m[2]);
      return n > 0 ? n : null;
    }
  }
  return sawRow ? null : undefined;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Checks one password. The field that held it should be cleared by the caller. */
export async function checkPassword(
  password: string,
  opts: { fetcher?: Fetcher; now?: () => Date } = {},
): Promise<PasswordCheck> {
  if (!password) return { kind: 'error', code: 'EMPTY' };
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const now = opts.now ?? (() => new Date());

  let hex: string;
  try {
    hex = await sha1Hex(password);
  } catch {
    // The only way sha1Hex fails is a missing crypto.subtle; the screen says so.
    return { kind: 'error', code: 'NO_CRYPTO' };
  }
  const { prefix, suffix } = splitHash(hex);

  let res: Response;
  try {
    res = await fetcher(RANGE_URL + prefix, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.warn('[breach] range fetch failed:', timedOut ? 'timeout' : 'network');
    return { kind: 'error', code: timedOut ? 'TIMEOUT' : 'NETWORK' };
  }
  if (res.status === 429) return { kind: 'error', code: 'RATE_LIMITED' };
  if (!res.ok) {
    console.warn('[breach] range fetch status', res.status);
    return { kind: 'error', code: 'BAD_RESPONSE' };
  }

  const count = countInRange(await res.text(), suffix);
  if (count === undefined) return { kind: 'error', code: 'BAD_RESPONSE' };
  if (count === null) return { kind: 'absent', checkedAt: now().toISOString() };
  return { kind: 'found', count };
}
