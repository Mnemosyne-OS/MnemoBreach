import { describe, it, expect, vi } from 'vitest';
import { checkPassword, countInRange, sha1Hex, splitHash, RANGE_URL } from './pwned';

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8 (published test vector).
const PW_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

function reply(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe('sha1Hex / splitHash', () => {
  it('hashes to the uppercase hex the range API uses', async () => {
    expect(await sha1Hex('password')).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
  });

  it('only the 5-character prefix is the part that leaves', () => {
    expect(splitHash('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8')).toEqual({ prefix: '5BAA6', suffix: PW_SUFFIX });
  });

  it('refuses anything that is not a 40-char hex hash', () => {
    expect(() => splitHash('abc')).toThrow('BAD_HASH');
  });
});

describe('countInRange', () => {
  it('finds the suffix, case-insensitive', () => {
    expect(countInRange(`003CD215739D7C1B2218670D26F81408237:2\r\n${PW_SUFFIX.toLowerCase()}:52372427`, PW_SUFFIX)).toBe(52372427);
  });

  it('a padding row (count 0) is ABSENT, never "seen 0 times"', () => {
    expect(countInRange(`${PW_SUFFIX}:0\n003CD215739D7C1B2218670D26F81408237:2`, PW_SUFFIX)).toBeNull();
  });

  it('a well-formed answer without the suffix is absent', () => {
    expect(countInRange('003CD215739D7C1B2218670D26F81408237:2', PW_SUFFIX)).toBeNull();
  });

  it('a body that is not a range answer is undefined, never absent', () => {
    expect(countInRange('<html>blocked</html>', PW_SUFFIX)).toBeUndefined();
    expect(countInRange('', PW_SUFFIX)).toBeUndefined();
  });
});

describe('checkPassword', () => {
  it('sends only the prefix, with padding asked for', async () => {
    const fetcher = vi.fn(() => Promise.resolve(reply(`${PW_SUFFIX}:3`)));
    const r = await checkPassword('password', { fetcher });
    expect(r).toEqual({ kind: 'found', count: 3 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${RANGE_URL}5BAA6`);
    expect(url).not.toContain(PW_SUFFIX);
    expect((init.headers as Record<string, string>)['Add-Padding']).toBe('true');
  });

  it('absent carries the instant it was checked', async () => {
    const r = await checkPassword('password', {
      fetcher: () => Promise.resolve(reply('003CD215739D7C1B2218670D26F81408237:2')),
      now: () => new Date('2026-10-07T12:00:00Z'),
    });
    expect(r).toEqual({ kind: 'absent', checkedAt: '2026-10-07T12:00:00.000Z' });
  });

  it('a network failure is an error, never "absent"', async () => {
    const r = await checkPassword('password', { fetcher: () => Promise.reject(new TypeError('Failed to fetch')) });
    expect(r).toEqual({ kind: 'error', code: 'NETWORK' });
  });

  it('a timeout says timeout', async () => {
    const err = new Error('t');
    err.name = 'TimeoutError';
    expect(await checkPassword('password', { fetcher: () => Promise.reject(err) })).toEqual({ kind: 'error', code: 'TIMEOUT' });
  });

  it('429 is rate-limited, other non-2xx a bad response', async () => {
    expect(await checkPassword('x', { fetcher: () => Promise.resolve(reply('', 429)) })).toEqual({ kind: 'error', code: 'RATE_LIMITED' });
    expect(await checkPassword('x', { fetcher: () => Promise.resolve(reply('', 503)) })).toEqual({ kind: 'error', code: 'BAD_RESPONSE' });
  });

  it('an unreadable body is a bad response, never absent', async () => {
    expect(await checkPassword('x', { fetcher: () => Promise.resolve(reply('<html/>')) })).toEqual({ kind: 'error', code: 'BAD_RESPONSE' });
  });

  it('an empty password sends nothing', async () => {
    const fetcher = vi.fn();
    expect(await checkPassword('', { fetcher })).toEqual({ kind: 'error', code: 'EMPTY' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never puts the password in a log line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await checkPassword('hunter2-secret', { fetcher: () => Promise.reject(new TypeError('x')) });
    await checkPassword('hunter2-secret', { fetcher: () => Promise.resolve(reply('', 500)) });
    for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toContain('hunter2');
    warn.mockRestore();
  });
});
