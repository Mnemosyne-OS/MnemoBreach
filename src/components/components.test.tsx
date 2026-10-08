import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Reveal } from './Reveal';
import { AccountCard } from './AccountCard';
import { NewsCard } from './NewsCard';
import { __resetProfileStoreForTests, getProfileSnapshot, updateProfile } from '../lib/profileStore';
import { __resetCatalogueForTests, loadCatalogue } from '../lib/catalogueStore';
import { __setInvokeForTests } from '../lib/account';
import { __setWatchInvokeForTests } from '../lib/watch';
import { EMPTY_PROFILE, type Profile } from '../lib/profile';

const ready = (over: Partial<Profile> = {}) =>
  __resetProfileStoreForTests({ status: 'ready', profile: { ...EMPTY_PROFILE, memory: {}, findings: {}, knownBreaches: [], ...over } });

beforeEach(() => {
  localStorage.clear();
  __resetCatalogueForTests();
});
afterEach(() => vi.restoreAllMocks());

describe('profileStore', () => {
  it('two writes in flight both survive: each applies to the result of the other', async () => {
    ready();
    await Promise.all([
      updateProfile((cur) => ({ ...cur, memory: { ...cur.memory, 'a@x.io': 1 } })),
      updateProfile((cur) => ({ ...cur, memory: { ...cur.memory, 'b@x.io': 2 } })),
    ]);
    expect(getProfileSnapshot().profile.memory).toEqual({ 'a@x.io': 1, 'b@x.io': 2 });
  });

  it('a refused save keeps the profile the screen had', async () => {
    ready({ emails: ['a@x.io'] });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await updateProfile((cur) => ({ ...cur, emails: [] }))).toBe(false);
    expect(getProfileSnapshot().profile.emails).toEqual(['a@x.io']);
  });

  it('nothing is written before the first read answered', async () => {
    __resetProfileStoreForTests();
    expect(await updateProfile((cur) => ({ ...cur, emails: ['x@y.io'] }))).toBe(false);
  });
});

describe('Reveal', () => {
  it('masked by default, clear while held, masked again on release, leave and blur', () => {
    render(<Reveal value="tony@gmail.com" masked="t***@gmail.com" />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('t***@gmail.com');
    fireEvent.pointerDown(btn);
    expect(btn).toHaveTextContent('tony@gmail.com');
    fireEvent.pointerUp(btn);
    expect(btn).toHaveTextContent('t***@gmail.com');
    fireEvent.keyDown(btn, { key: ' ' });
    expect(btn).toHaveTextContent('tony@gmail.com');
    fireEvent.blur(btn);
    expect(btn).toHaveTextContent('t***@gmail.com');
    fireEvent.pointerDown(btn);
    fireEvent.pointerLeave(btn);
    expect(btn).toHaveTextContent('t***@gmail.com');
  });
});

describe('AccountCard', () => {
  it('calls the host for nothing before the person opens the door', async () => {
    ready({ emails: ['a@x.io'] });
    const invoke = vi.fn(() => Promise.resolve({ present: false, savedAt: null, seal: 'sealed' }));
    __setInvokeForTests(invoke as never);
    render(<AccountCard />);
    await act(async () => { await Promise.resolve(); });
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use my Have I Been Pwned key' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('breach.keyState'));
    await waitFor(() => expect(getProfileSnapshot().profile.doorOpened).toBe(true));
  });

  it('an email removed while its search was in flight never lands on the timeline', async () => {
    ready({ emails: ['a@x.io'], doorOpened: true });
    let answer: (v: unknown) => void = () => {};
    __setInvokeForTests(((action: string) => {
      if (action === 'breach.keyState') return Promise.resolve({ present: true, savedAt: 1, seal: 'sealed' });
      if (action === 'breach.lookup') return new Promise((r) => { answer = r; });
      return Promise.resolve({});
    }) as never);
    render(<AccountCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));
    await act(async () => { await updateProfile((cur) => ({ ...cur, emails: [] })); });
    await act(async () => {
      answer({ kind: 'found', checkedAt: '2026-10-07T00:00:00.000Z', breaches: [{ Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com', BreachDate: '2013-10-04', DataClasses: ['Passwords'] }] });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getProfileSnapshot().profile.findings).toEqual({});
  });
});

describe('NewsCard', () => {
  const catalogue = [{ Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com', BreachDate: '2013-10-04', DataClasses: ['Passwords'] }];

  it('the first visit remembers the list, announces nothing, and stays a first visit', async () => {
    ready();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(catalogue)));
    await loadCatalogue();
    render(<NewsCard />);
    await waitFor(() => expect(getProfileSnapshot().profile.knownBreaches).toEqual(['Adobe']));
    expect(screen.getByText(/First visit/)).toBeInTheDocument();
    expect(screen.queryByText(/Since your last visit/)).not.toBeInTheDocument();
  });

  it('a later visit shows the new breach on a service of the timeline first', async () => {
    ready({
      knownBreaches: ['Old'], knownAt: '2026-10-01T00:00:00.000Z',
      findings: { Adobe2013: { name: 'Adobe2013', title: 'Adobe 2013', domain: 'adobe.com', breachDate: '2013-10-04', addedDate: null, dataClasses: [], source: 'declared', emails: [], firstSeenAt: '2026-01-01T00:00:00.000Z', actions: {} } },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([...catalogue, { Name: 'Old', Title: 'Old', Domain: 'old.com', BreachDate: '2010-01-01', DataClasses: [] }])));
    await loadCatalogue();
    render(<NewsCard />);
    expect(await screen.findByText('1 new breach on a service of your timeline:')).toBeInTheDocument();
    expect(screen.getByText('Adobe')).toBeInTheDocument();
  });

  it('the watch stops when the timeline has no service left, instead of asking HIBP forever', async () => {
    ready({ watchOn: true, watchSig: 'adobe.com', knownBreaches: ['Adobe'] });
    const calls: string[] = [];
    __setWatchInvokeForTests(((action: string) => {
      calls.push(action);
      if (action === 'watch.inbox') return Promise.resolve({ items: [], status: null });
      return Promise.resolve({});
    }) as never);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(catalogue)));
    await loadCatalogue();
    render(<NewsCard />);
    await waitFor(() => expect(calls).toContain('watch.unregister'));
    expect(calls).not.toContain('watch.register');
    await waitFor(() => expect(getProfileSnapshot().profile.watchSig).toBe(''));
    expect(await screen.findByText(/nothing is being watched/)).toBeInTheDocument();
  });
});
