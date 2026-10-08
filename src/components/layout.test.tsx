/**
 * layout.test.tsx — the glass board of 08/10: identifiers and search in one
 * tile, the crossing sentence that names the first few services, the link to
 * get an HIBP key, and the version badge read from the manifest.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { AccountCard } from './AccountCard';
import { TimelineCard } from './TimelineCard';
import { __resetProfileStoreForTests, getProfileSnapshot } from '../lib/profileStore';
import { __resetCatalogueForTests } from '../lib/catalogueStore';
import { __setLinksInvokeForTests, HIBP_KEY_PAGE } from '../lib/links';
import { EMPTY_PROFILE, type Profile } from '../lib/profile';
import type { Finding } from '../lib/findings';
import manifest from '../../mnemo-plugin.json';

const ready = (over: Partial<Profile> = {}) =>
  __resetProfileStoreForTests({ status: 'ready', profile: { ...EMPTY_PROFILE, memory: {}, findings: {}, knownBreaches: [], ...over } });

const found = (n: number): Record<string, Finding> => Object.fromEntries(
  Array.from({ length: n }, (_, i) => {
    const name = `Svc${i + 1}`;
    return [name, {
      name, title: name, domain: `svc${i + 1}.com`, breachDate: '2020-01-01', addedDate: null,
      dataClasses: ['Email addresses', 'Phone numbers'], source: 'found', emails: ['a@x.io'],
      firstSeenAt: '2026-01-01T00:00:00.000Z', actions: {}, flag: null,
    } as Finding];
  }),
);

beforeEach(() => {
  localStorage.clear();
  __resetCatalogueForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('one tile for the identifiers and their search', () => {
  it('each email carries Search and Remove; a phone carries Remove only', () => {
    ready({ emails: ['a@x.io'], phones: ['+33612345678'] });
    render(<AccountCard />);
    expect(screen.getByRole('heading', { name: 'Your identifiers' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Search' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
  });

  it('Remove takes the identifier off the profile', async () => {
    ready({ emails: ['a@x.io', 'b@x.io'] });
    render(<AccountCard />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
    await waitFor(() => expect(getProfileSnapshot().profile.emails).toEqual(['b@x.io']));
  });

  it('the form at the bottom adds an email, which gets its own Search', async () => {
    ready();
    render(<AccountCard />);
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Email or phone number'), { target: { value: 'new@x.io' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(getProfileSnapshot().profile.emails).toEqual(['new@x.io']);
  });
});

describe('the crossing sentence names the first five services', () => {
  it('102 services: five names and "and 97 more", the full list one press away', () => {
    ready({ findings: found(102) });
    render(<TimelineCard />);
    const sentence = screen.getByText(/102 breaches leaked phone numbers/);
    expect(sentence.textContent).toContain('Svc1, Svc2, Svc3, Svc4, Svc5 and 97 more');
    expect(sentence.textContent).not.toContain('Svc6');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 102 names' }));
    expect(screen.getByText(/102 breaches leaked phone numbers/).textContent).toContain('Svc102');
    expect(screen.getByRole('button', { name: 'Hide the list' })).toBeInTheDocument();
  });

  it('six services or fewer: every name, no button', () => {
    ready({ findings: found(6) });
    render(<TimelineCard />);
    expect(screen.getByText(/6 breaches leaked phone numbers/).textContent).toContain('Svc6');
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });
});

describe('the link to get a key', () => {
  it('opens the page where HIBP sells the key', async () => {
    ready({ emails: ['a@x.io'] });
    const invoke = vi.fn(() => Promise.resolve({ success: true }));
    __setLinksInvokeForTests(invoke as never);
    render(<AccountCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Get a key on haveibeenpwned.com' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('shell.openExternal', { url: HIBP_KEY_PAGE }));
    expect(HIBP_KEY_PAGE).toBe('https://haveibeenpwned.com/API/Key');
  });
});

describe('the version badge', () => {
  it('shows the version of the manifest', () => {
    ready();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    render(<App />);
    expect(screen.getByText(`v${manifest.version}`)).toBeInTheDocument();
  });
});
