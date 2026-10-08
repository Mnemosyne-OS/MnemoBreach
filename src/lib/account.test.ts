import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __setInvokeForTests, codeOf, lookup, readKeyState, saveKey } from './account';
import { chronicleText, forgetAll, remember, __setMemoryInvokeForTests, BREACH_SPINE } from './memory';

const ENTRY = {
  Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com', BreachDate: '2013-10-04', AddedDate: '2013-12-04T00:00:00Z',
  PwnCount: 152445165, DataClasses: ['Email addresses', 'Passwords'],
};

describe('codeOf', () => {
  it('finds the host code in a rejection, never passes the raw message on', () => {
    expect(codeOf(new Error('NOT_DECLARED'))).toBe('NOT_DECLARED');
    expect(codeOf(new Error('Host did not reply to "breach.lookup" within 20s'))).toBe('TIMEOUT');
    expect(codeOf(new Error('Unauthorized: This cartridge does not have the "breach:lookup" permission.'))).toBe('PERMISSION_DENIED');
    expect(codeOf(new Error('something else'))).toBe('FAILED');
  });
});

describe('lookup', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends only the account, and normalises what comes back', async () => {
    const invoke = vi.fn(() => Promise.resolve({ kind: 'found', breaches: [ENTRY], checkedAt: '2026-10-07T00:00:00.000Z' }));
    __setInvokeForTests(invoke as never);
    const r = await lookup('a@x.io');
    expect(invoke).toHaveBeenCalledWith('breach.lookup', { account: 'a@x.io' });
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.breaches[0]!.breachDate).toBe('2013-10-04');
  });

  it('absent keeps its date', async () => {
    __setInvokeForTests((() => Promise.resolve({ kind: 'absent', checkedAt: '2026-10-07T00:00:00.000Z' })) as never);
    expect(await lookup('a@x.io')).toEqual({ kind: 'absent', checkedAt: '2026-10-07T00:00:00.000Z', via: 'hibp' });
  });

  it('a shape it cannot read is BAD_RESPONSE, never absent', async () => {
    __setInvokeForTests((() => Promise.resolve({ kind: 'absent' })) as never);
    expect(await lookup('a@x.io')).toEqual({ kind: 'error', code: 'BAD_RESPONSE' });
    __setInvokeForTests((() => Promise.resolve({ kind: 'found', breaches: 'x', checkedAt: '2026' })) as never);
    expect(await lookup('a@x.io')).toEqual({ kind: 'error', code: 'BAD_RESPONSE' });
  });

  it('a host refusal becomes its code, and the email never reaches a log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    __setInvokeForTests((() => Promise.reject(new Error('KEY_REFUSED'))));
    expect(await lookup('secret.person@x.io')).toEqual({ kind: 'error', code: 'KEY_REFUSED' });
    for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toContain('secret.person');
  });
});

describe('the HIBP wait', () => {
  it('rides in the rejection and reaches the result; absent stays absent', async () => {
    __setInvokeForTests((() => Promise.reject(new Error('RATE_LIMITED retryAfter=4'))));
    expect(await lookup('a@x.io')).toEqual({ kind: 'error', code: 'RATE_LIMITED', retryAfterSec: 4 });
    __setInvokeForTests((() => Promise.reject(new Error('RATE_LIMITED'))));
    expect(await lookup('a@x.io')).toEqual({ kind: 'error', code: 'RATE_LIMITED' });
  });
});

describe('key state', () => {
  it('reads present / savedAt / seal, an unknown seal stays unknown', async () => {
    __setInvokeForTests((() => Promise.resolve({ present: true, savedAt: 0, seal: 'weird' })) as never);
    expect(await readKeyState()).toEqual({ present: true, savedAt: null, seal: 'unknown' });
  });

  it('saveKey reports the shape warning', async () => {
    __setInvokeForTests((() => Promise.resolve({ present: true, savedAt: 5, seal: 'sealed', warning: 'UNEXPECTED_SHAPE' })) as never);
    expect(await saveKey('k')).toEqual({ state: { present: true, savedAt: 5, seal: 'sealed' }, warning: true });
  });
});

describe('chronicleText', () => {
  it('found: masked identifier, dates, what leaked; never the email in clear', () => {
    const text = chronicleText('tony.secret@example.com', {
      kind: 'found', checkedAt: '2026-10-07T12:00:00.000Z',
      breaches: [{ name: 'Adobe', title: 'Adobe', domain: 'adobe.com', breachDate: '2013-10-04', addedDate: null, pwnCount: null, dataClasses: ['Passwords'], description: '', verified: true, fabricated: false, spamList: false, retired: false }],
    })!;
    expect(text).toContain('t***@example.com');
    expect(text).not.toContain('tony.secret');
    expect(text).toContain('2026-10-07');
    expect(text).toContain('Adobe (adobe.com): breached 2013-10-04.');
    expect(text).toContain('Leaked: Passwords.');
    expect(text).toContain('1 known data breach ');
  });

  it('absent is remembered as a dated absence, never as "safe"', () => {
    const text = chronicleText('a@x.io', { kind: 'absent', checkedAt: '2026-10-07T00:00:00.000Z' })!;
    expect(text).toContain('does not mean safe');
  });

  it('an error is not a fact to remember', () => {
    expect(chronicleText('a@x.io', { kind: 'error', code: 'NETWORK' })).toBeNull();
  });
});

describe('remember', () => {
  it('writes into the sandbox with no email in sourceRef, then forgets the previous one', async () => {
    const calls: Array<[string, unknown]> = [];
    __setMemoryInvokeForTests(((action: string, payload: unknown) => {
      calls.push([action, payload]);
      if (action === 'permissions.refresh') return Promise.resolve({ granted: { 'vault:write': true } });
      if (action === 'vault.sandbox.ensure') return Promise.resolve({ vault: 'APP-MNEMO-BREACH', unlocked: false });
      if (action === 'social.ingest') return Promise.resolve({ chronicleId: 42 });
      return Promise.resolve({});
    }) as never);
    const r = await remember('text', 7);
    expect(r).toEqual({ id: 42, vault: 'APP-MNEMO-BREACH', unlocked: false });
    const ingest = calls.find(([a]) => a === 'social.ingest')![1] as { spineType: string; sourceRef: string };
    expect(ingest.spineType).toBe(BREACH_SPINE);
    expect(ingest.sourceRef).not.toContain('@');
    const order = calls.map(([a]) => a);
    expect(order.indexOf('social.ingest')).toBeLessThan(order.indexOf('vault.sandbox.forget'));
    expect(calls.find(([a]) => a === 'vault.sandbox.forget')![1]).toEqual({ ids: [7] });
  });

  it('a write without an id throws, and forgets nothing', async () => {
    const forget = vi.fn();
    __setMemoryInvokeForTests(((action: string) => {
      if (action === 'permissions.refresh') return Promise.resolve({ granted: { 'vault:write': true } });
      if (action === 'vault.sandbox.ensure') return Promise.resolve({ vault: 'V', unlocked: true });
      if (action === 'vault.sandbox.forget') { forget(); return Promise.resolve({}); }
      return Promise.resolve({});
    }) as never);
    await expect(remember('text', 7)).rejects.toThrow('NO_CHRONICLE_ID');
    expect(forget).not.toHaveBeenCalled();
  });

  it('a refused vault permission stops before any write', async () => {
    const ingest = vi.fn();
    __setMemoryInvokeForTests(((action: string) => {
      if (action === 'permissions.refresh') return Promise.resolve({ granted: { 'vault:write': false } });
      if (action === 'social.ingest') ingest();
      return Promise.resolve({});
    }) as never);
    await expect(remember('text', null)).rejects.toThrow('PERMISSION_DENIED');
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('the forget envelope (verification T1)', () => {
  const host = (forgetAnswer: unknown) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    __setMemoryInvokeForTests(((action: string) => {
      if (action === 'permissions.refresh') return Promise.resolve({ granted: { 'vault:write': true } });
      if (action === 'vault.sandbox.ensure') return Promise.resolve({ vault: 'V', unlocked: true });
      if (action === 'social.ingest') return Promise.resolve({ chronicleId: 42 });
      if (action === 'vault.sandbox.forget') return Promise.resolve(forgetAnswer);
      return Promise.resolve({});
    }) as never);
    return warn;
  };

  it('a refused forget during remember is said, not passed off as done', async () => {
    const warn = host({ success: false, error: 'NO_VAULT_ROOT' });
    await remember('text', 7);
    expect(warn.mock.calls.some((c) => String(c[1]).includes('NO_VAULT_ROOT'))).toBe(true);
  });

  it('forgetAll throws on a refusal and returns the measured count, null when unsaid', async () => {
    host({ success: false, error: 'NO_VAULT_ROOT' });
    await expect(forgetAll([1, 2])).rejects.toThrow('NO_VAULT_ROOT');
    host({ success: true, forgotten: 2 });
    expect(await forgetAll([1, 2])).toBe(2);
    host({ success: true });
    expect(await forgetAll([1, 2])).toBeNull();
    expect(await forgetAll([])).toBe(0);
  });
});
