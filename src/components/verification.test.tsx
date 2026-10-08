/**
 * verification.test.tsx — what the cold verification pass of 07/10 found held
 * by nothing (doc 141 §18): each test here was missing, and each one fails on
 * the code before its fix or under its mutant.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountCard } from './AccountCard';
import { NewsCard } from './NewsCard';
import { PasswordCard } from './PasswordCard';
import { __resetProfileStoreForTests, getProfileSnapshot } from '../lib/profileStore';
import { __resetCatalogueForTests, loadCatalogue } from '../lib/catalogueStore';
import { __setInvokeForTests } from '../lib/account';
import { __setMemoryInvokeForTests } from '../lib/memory';
import { __setWatchInvokeForTests } from '../lib/watch';
import { watchPlan } from '../lib/news';
import { EMPTY_PROFILE, type Profile } from '../lib/profile';

const ready = (over: Partial<Profile> = {}) =>
  __resetProfileStoreForTests({ status: 'ready', profile: { ...EMPTY_PROFILE, memory: {}, findings: {}, knownBreaches: [], ...over } });

const keyPresent = (present: boolean, lookupAnswer?: unknown) =>
  __setInvokeForTests(((action: string) => {
    if (action === 'breach.keyState') return Promise.resolve({ present, savedAt: present ? 1 : null, seal: 'sealed' });
    if (action === 'breach.lookup') return Promise.resolve(lookupAnswer);
    return Promise.resolve({});
  }) as never);

beforeEach(() => {
  localStorage.clear();
  __resetCatalogueForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('T2: a refused permission is not a door opened', () => {
  it('Deny leaves doorOpened false, so the next opening raises nothing', async () => {
    ready({ emails: ['a@x.io'] });
    __setInvokeForTests((() => Promise.reject(new Error('Unauthorized: This cartridge does not have the "breach:lookup" permission.'))));
    render(<AccountCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Use my Have I Been Pwned key' }));
    expect(await screen.findByText(/Permission refused/)).toBeInTheDocument();
    expect(getProfileSnapshot().profile.doorOpened).toBe(false);
  });
});

describe('no key: the free search, with no host call (doc 141 §20)', () => {
  it('searches XposedOrNot from the iframe, credits it, and never asks the host', async () => {
    ready({ emails: ['a@x.io'] });
    const invoke = vi.fn(() => Promise.resolve({}));
    __setInvokeForTests(invoke as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ExposedBreaches: null })));
    render(<AccountCard />);
    expect(screen.getByText(/XposedOrNot, a free service/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/Absent from the known breaches/)).toBeInTheDocument();
    expect(screen.getByText(/Results from XposedOrNot/)).toBeInTheDocument();
    expect(fetchSpy.mock.calls[0]![0] as string).toContain('api.xposedornot.com');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('with the key present, the search goes through the host and says HIBP', async () => {
    ready({ emails: ['a@x.io'], doorOpened: true });
    keyPresent(true, { kind: 'absent', checkedAt: '2026-10-07T00:00:00.000Z' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<AccountCard />);
    expect(await screen.findByText(/to Have I Been Pwned, with your own key/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/Absent from the known breaches/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Results from XposedOrNot/)).not.toBeInTheDocument();
  });
});

describe('T3: a spam list in a search result says so', () => {
  it('the result row carries the HIBP flag', async () => {
    ready({ emails: ['a@x.io'], doorOpened: true });
    keyPresent(true, { kind: 'found', checkedAt: '2026-10-07T00:00:00.000Z', breaches: [{ Name: 'Spam', Title: 'Spam list X', Domain: '', BreachDate: '2020-01-01', DataClasses: ['Email addresses'], IsSpamList: true }] });
    render(<AccountCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Spam list')).toBeInTheDocument();
  });
});

describe('T1: a refused forget keeps the saved ids and says so', () => {
  const setup = (forgetAnswer: unknown) => {
    ready({ emails: ['a@x.io'], doorOpened: true, memory: { 'a@x.io': 9 } });
    keyPresent(true);
    __setMemoryInvokeForTests(((action: string) => Promise.resolve(action === 'vault.sandbox.forget' ? forgetAnswer : {})) as never);
    render(<AccountCard />);
  };

  it('refused: the ids stay, the screen says the vault refused', async () => {
    setup({ success: false, error: 'NO_VAULT_ROOT' });
    fireEvent.click(await screen.findByRole('button', { name: 'Forget the saved result' }));
    expect(await screen.findByText(/refused to forget/)).toBeInTheDocument();
    expect(getProfileSnapshot().profile.memory).toEqual({ 'a@x.io': 9 });
  });

  it('done: the ids go, the screen says how many the vault forgot', async () => {
    setup({ success: true, forgotten: 1 });
    fireEvent.click(await screen.findByRole('button', { name: 'Forget the saved result' }));
    expect(await screen.findByText('1 result forgotten from memory.')).toBeInTheDocument();
    expect(getProfileSnapshot().profile.memory).toEqual({});
  });
});

describe('M11: the password field empties after the answer', () => {
  it('cleared on an answer and on a failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('003CD215739D7C1B2218670D26F81408237:2')).mockRejectedValueOnce(new TypeError('x'));
    render(<PasswordCard />);
    const field = screen.getByPlaceholderText('Password');
    for (const expected of [/Absent from the known breaches/, /Could not reach the service/]) {
      fireEvent.change(field, { target: { value: 'hunter2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Check' }));
      expect(await screen.findByText(expected)).toBeInTheDocument();
      expect(field).toHaveValue('');
    }
  });
});

describe('NewsCard wiring', () => {
  const catalogue = [{ Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com', BreachDate: '2013-10-04', DataClasses: [] }];

  it('M27: a first visit that could not be saved is said', async () => {
    ready();
    // On the prototype: under jsdom a spy set on the storage object itself
    // is stored as an ITEM, and setItem keeps working.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(catalogue)));
    await loadCatalogue();
    render(<NewsCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved');
  });

  it('M34: the watch is not registered again while the services are unchanged', async () => {
    const findings = { Adobe: { name: 'Adobe', title: 'Adobe', domain: 'adobe.com', breachDate: '2013-10-04', addedDate: null, dataClasses: [], source: 'declared' as const, emails: [], firstSeenAt: '2026-01-01T00:00:00.000Z', actions: {}, flag: null } };
    ready({ watchOn: true, watchSig: watchPlan(findings).signature, findings, knownBreaches: ['Adobe'] });
    const calls: string[] = [];
    __setWatchInvokeForTests(((action: string) => {
      calls.push(action);
      return Promise.resolve(action === 'watch.inbox' ? { items: [], status: null } : {});
    }) as never);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(catalogue)));
    await loadCatalogue();
    render(<NewsCard />);
    await waitFor(() => expect(calls).toContain('watch.inbox'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(calls).not.toContain('watch.register');
    expect(calls).not.toContain('watch.unregister');
  });
});
