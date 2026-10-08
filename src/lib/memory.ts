/**
 * memory.ts — one chronicle per email search, written on a GESTURE (doc 141 §9).
 *
 * Where: the cartridge's own sandbox vault (`vault.sandbox.ensure`, doc 58),
 * the same door Ember uses. A sandbox stays out of the chat, the dreams and the
 * neural map until the person unlocks its permanence in the vault panel; the
 * screen says so instead of pretending the chat can read it.
 *
 * What: the MASKED identifier, the date of the check, and per breach its dates
 * and what leaked. 🚨 Never the email in clear, never in `sourceRef` either.
 *
 * Replace, never stack: the new chronicle is written FIRST, then the previous
 * one for that email is forgotten, so a failed write never leaves nothing.
 */
import { maskEmail } from './mask';
import type { AccountResult } from './account';
import { sdk } from './profile';

export const BREACH_SPINE = 'SECURITY_CHECK';
const CALL_MS = 15_000;

type Invoke = <T>(action: string, payload?: unknown) => Promise<T>;
let invoke: Invoke = (action, payload) => sdk.invoke(action, payload, CALL_MS);

/** Tests only. */
export function __setMemoryInvokeForTests(fn: Invoke): void {
  invoke = fn;
}

/**
 * The text of one chronicle. English on purpose: it is read by the retrieval
 * and the model, in every language of the app, like Ember's digests.
 * Returns null for an error result: a failed search is not a fact to remember.
 */
export function chronicleText(email: string, result: AccountResult): string | null {
  const who = maskEmail(email);
  const day = result.kind === 'error' ? '' : result.checkedAt.slice(0, 10);
  const source = result.kind !== 'error' && result.via === 'xon' ? 'XposedOrNot' : 'Have I Been Pwned';
  if (result.kind === 'absent') {
    return `MnemoBreach check on ${day}: ${who} was absent from the data breaches ${source} knew that day. Absent from known breaches does not mean safe.`;
  }
  if (result.kind !== 'found') return null;
  const lines = result.breaches.map((b) => {
    const when = b.breachDate ? `breached ${b.datePrecision === 'year' ? `in ${b.breachDate.slice(0, 4)}` : b.breachDate}` : 'breach date unknown';
    const pub = b.addedDate ? `, made public ${b.addedDate}` : '';
    const what = b.dataClasses.length ? ` Leaked: ${b.dataClasses.join(', ')}.` : '';
    return `- ${b.title}${b.domain ? ` (${b.domain})` : ''}: ${when}${pub}.${what}`;
  });
  return [
    `MnemoBreach check on ${day}: ${who} appears in ${result.breaches.length} known data breach${result.breaches.length === 1 ? '' : 'es'} (source: ${source}).`,
    ...lines,
    'Nobody can remove data from a leak: change the passwords of these services and turn on two-factor sign-in.',
  ].join('\n');
}

/**
 * `vault.sandbox.forget` answers its envelope `{ success, forgotten?, error? }`
 * as is: unlike the `breach.*` actions it does NOT reject on a refusal (Muse
 * reads that envelope). Awaiting it proves nothing; this reads it.
 * 🎭 `forgotten` absent is unknown, never 0.
 */
export function forgetOutcome(answer: unknown): { ok: boolean; forgotten: number | null; error: string | null } {
  const a = (answer ?? {}) as { success?: unknown; forgotten?: unknown; error?: unknown };
  return {
    ok: a.success === true,
    forgotten: typeof a.forgotten === 'number' && a.forgotten >= 0 ? a.forgotten : null,
    error: typeof a.error === 'string' ? a.error : null,
  };
}

function idOf(answer: unknown): number | null {
  const raw = (answer as { chronicleId?: unknown } | null)?.chronicleId;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export interface Remembered {
  id: number;
  vault: string;
  /** false = the chat does not read this vault until the person unlocks it. */
  unlocked: boolean;
}

/** Writes one chronicle, then forgets `previousId`. Throws a named error. */
export async function remember(text: string, previousId: number | null): Promise<Remembered> {
  const refreshed = await invoke<{ granted?: Record<string, boolean> }>('permissions.refresh', { permissions: ['vault:write'] });
  if (refreshed?.granted?.['vault:write'] === false) throw new Error('PERMISSION_DENIED');
  const { vault, unlocked } = await invoke<{ vault: string; unlocked: boolean }>('vault.sandbox.ensure', {});
  const answer = await invoke<unknown>('social.ingest', { vault, content: text, spineType: BREACH_SPINE, sourceRef: 'breach-watch:check' });
  const id = idOf(answer);
  if (id === null) throw new Error('NO_CHRONICLE_ID');
  if (previousId !== null && previousId !== id) {
    try {
      const out = forgetOutcome(await invoke<unknown>('vault.sandbox.forget', { ids: [previousId] }));
      // The new one is written; the old one stays readable. Said, not swallowed.
      if (!out.ok) console.warn('[breach] previous check could not be forgotten:', out.error ?? 'refused');
    } catch (err) {
      console.warn('[breach] previous check could not be forgotten:', err instanceof Error ? err.message : String(err));
    }
  }
  return { id, vault, unlocked: unlocked === true };
}

/**
 * Takes every written chronicle back. Throws a named error when the host
 * refused, so the caller keeps the ids instead of losing them. Returns how many
 * the host says it forgot, or null when it did not say.
 */
export async function forgetAll(ids: number[]): Promise<number | null> {
  if (ids.length === 0) return 0;
  const out = forgetOutcome(await invoke<unknown>('vault.sandbox.forget', { ids }));
  if (!out.ok) throw new Error(out.error ?? 'FORGET_FAILED');
  return out.forgotten;
}
