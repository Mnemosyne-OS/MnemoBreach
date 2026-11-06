/**
 * BreachAgentActions — serves MnemoBreach's agent actions (doc 149) while the
 * window is open. A CHILD that renders nothing, never a hook in App. The
 * handlers live in lib/agent.ts and read the shared stores at each call, so
 * they always see what the screen shows; this only subscribes ONCE.
 */
import { useEffect } from 'react';
import { breachAgentHandlers } from '../lib/agent';
import { getCatalogueSnapshot, loadCatalogue } from '../lib/catalogueStore';
import { hasHost, sdk } from '../lib/profile';
import { getProfileSnapshot, updateProfile } from '../lib/profileStore';
import { unregisterWatch } from '../lib/watch';

export function BreachAgentActions() {
  useEffect(() => {
    // Outside the shell nobody calls (a plain tab, the tests).
    if (!hasHost()) return undefined;
    if (typeof sdk.onAgentActions !== 'function') {
      // An iframe served an older SDK build: it must not take the window down.
      console.warn('[breach] this SDK build has no onAgentActions; reload the cartridge to serve agent actions');
      return undefined;
    }
    const sub = sdk.onAgentActions(breachAgentHandlers(() => ({
      profile: getProfileSnapshot(),
      updateProfile,
      catalogue: getCatalogueSnapshot,
      loadCatalogue: () => loadCatalogue(),
      unregisterWatch,
      now: () => new Date(),
    })));
    sub.ready.catch((err: unknown) => console.warn('[breach] agent actions not served:', err instanceof Error ? err.message : err));
    return () => sub.off();
  }, []);

  return null;
}
