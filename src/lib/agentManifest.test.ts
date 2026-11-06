/**
 * MnemoBreach's agent actions (doc 149): the manifest's declaration passes the
 * HOST's own check, and every declared action has its handler (a declared
 * action without one would be offered to agents and fail).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentActionsFromManifest } from '../../../infinity-edition/src/main/plugins/cartridgeAgentActions';
import { ACTION_IDS, breachAgentHandlers } from './agent';

const root = join(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'mnemo-plugin.json'), 'utf8')) as unknown;
const source = readFileSync(join(root, 'src', 'lib', 'agent.ts'), 'utf8');
const block = source.slice(source.indexOf('// agent-actions:begin'), source.indexOf('// agent-actions:end'));
const handlers = [...block.matchAll(/^ {4}(\w+): (?:async )?\(/gm)].map((m) => m[1]);

function declared() {
  const r = agentActionsFromManifest(manifest);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe("MnemoBreach's agent actions", () => {
  it("pass the host's check of the manifest", () => {
    const r = agentActionsFromManifest(manifest);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
  });

  it('every declared action has its handler, and no handler is undeclared', () => {
    expect(handlers.length).toBeGreaterThan(3);
    expect([...handlers].sort()).toEqual(declared().map((a) => a.id).sort());
    expect(Object.keys(breachAgentHandlers(() => { throw new Error('unused'); })).sort()).toEqual([...handlers].sort());
  });

  it('nothing spends credits, and only the lists are reads', () => {
    expect(declared().filter((a) => a.effect === 'spend')).toEqual([]);
    expect(declared().filter((a) => a.effect === 'read').map((a) => a.id).sort()).toEqual(['breaches', 'catalogue', 'news']);
  });

  it('voice: example sentences in fr, en and es, and a guide that says to name things as the person does', () => {
    const m = manifest as { voiceCommands?: Record<string, string[]>; agentGuide?: string[] };
    for (const lang of ['fr', 'en', 'es']) expect(m.voiceCommands?.[lang]?.length).toBeGreaterThanOrEqual(5);
    expect(m.agentGuide?.[0]).toMatch(/AMBIGUOUS/);
  });

  it("the steps it offers are the timeline's own", () => {
    const p = declared().find((a) => a.id === 'markAction')!.params.action;
    expect(p.type === 'string' ? p.enum : null).toEqual([...ACTION_IDS]);
  });
});
