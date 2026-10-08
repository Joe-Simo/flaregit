import {expect, test} from 'bun:test';
import {
  CLIENT_CAPABILITIES,
  CLIENT_REQUESTS_PER_MINUTE,
  CLIENT_SURFACES,
  WEB_INTERACTIVE_ROLES,
  canPerform,
  checkWebInteractiveElement,
  createClientRequestBudget,
  requiresConfirmation,
  type ClientCapability,
  type ClientSurface,
} from '../src/core/client-capabilities';
import type {Role} from '../src/core/org-access';
import type {Scope} from '../src/core/token-scopes';

const ROLES: Role[] = ['none', 'read', 'triage', 'write', 'admin'];
const CONFIRMED = {confirmationToken: 'confirmed'};

test('the client surfaces and capabilities are the agreed set', () => {
  expect(CLIENT_SURFACES).toEqual(['web', 'cli', 'api']);
  expect(CLIENT_CAPABILITIES).toEqual(['read_repository', 'comment', 'review', 'merge', 'manage_members', 'delete_repository']);
});

test('web and cli grant exactly what the role allows, and agree with each other', () => {
  const expected: Record<Role, ClientCapability[]> = {
    none: [],
    read: ['read_repository', 'comment'],
    triage: ['read_repository', 'comment', 'review'],
    write: ['read_repository', 'comment', 'review', 'merge'],
    admin: ['read_repository', 'comment', 'review', 'merge', 'manage_members', 'delete_repository'],
  };
  for (const surface of ['web', 'cli'] as const) {
    for (const role of ROLES) {
      expect(CLIENT_CAPABILITIES.filter((capability) => canPerform(surface, capability, {role, ...CONFIRMED}))).toEqual(expected[role]);
    }
  }
});

test('web and cli ignore token scopes and act with the role alone', () => {
  expect(canPerform('web', 'merge', {role: 'write', tokenScopes: []})).toBe(true);
  expect(canPerform('cli', 'merge', {role: 'write', tokenScopes: ['code:read']})).toBe(true);
  expect(canPerform('web', 'merge', {role: 'read', tokenScopes: ['code:write']})).toBe(false);
});

test('an api token needs a role that allows the capability and the scope that capability maps to', () => {
  expect(canPerform('api', 'read_repository', {role: 'read', tokenScopes: ['code:read']})).toBe(true);
  expect(canPerform('api', 'read_repository', {role: 'read'})).toBe(false);
  expect(canPerform('api', 'read_repository', {role: 'read', tokenScopes: []})).toBe(false);
  expect(canPerform('api', 'merge', {role: 'read', tokenScopes: ['code:write']})).toBe(false);
  expect(canPerform('api', 'merge', {role: 'write', tokenScopes: ['code:read']})).toBe(false);
  expect(canPerform('api', 'merge', {role: 'write', tokenScopes: ['code:write']})).toBe(true);
});

test('a write scope implies read of the same resource, and a read scope never implies write', () => {
  expect(canPerform('api', 'read_repository', {role: 'write', tokenScopes: ['code:write']})).toBe(true);
  expect(canPerform('api', 'review', {role: 'triage', tokenScopes: ['reviews:read']})).toBe(false);
  expect(canPerform('api', 'review', {role: 'triage', tokenScopes: ['reviews:write']})).toBe(true);
  expect(canPerform('api', 'comment', {role: 'read', tokenScopes: ['issues:write']})).toBe(true);
  expect(canPerform('api', 'comment', {role: 'read', tokenScopes: ['issues:read', 'code:write', 'reviews:write']})).toBe(false);
});

test('api tokens can never manage members or delete repositories, because no token scope grants them', () => {
  const everyScope: readonly Scope[] = ['issues:write', 'code:write', 'reviews:write'];
  expect(canPerform('api', 'manage_members', {role: 'admin', tokenScopes: everyScope, ...CONFIRMED})).toBe(false);
  expect(canPerform('api', 'delete_repository', {role: 'admin', tokenScopes: everyScope, ...CONFIRMED})).toBe(false);
});

test('delete_repository is the only destructive capability and needs a confirmation token from every surface', () => {
  expect(requiresConfirmation('delete_repository')).toBe(true);
  expect(CLIENT_CAPABILITIES.filter((capability) => requiresConfirmation(capability))).toEqual(['delete_repository']);
  for (const surface of CLIENT_SURFACES) {
    expect(canPerform(surface, 'delete_repository', {role: 'admin', tokenScopes: ['code:write']})).toBe(false);
    expect(canPerform(surface, 'delete_repository', {role: 'admin', confirmationToken: '   '})).toBe(false);
  }
  expect(canPerform('web', 'delete_repository', {role: 'admin', ...CONFIRMED})).toBe(true);
  expect(canPerform('cli', 'delete_repository', {role: 'admin', ...CONFIRMED})).toBe(true);
});

test('a confirmation token never substitutes for the role', () => {
  expect(canPerform('web', 'delete_repository', {role: 'write', ...CONFIRMED})).toBe(false);
  expect(canPerform('cli', 'delete_repository', {role: 'triage', ...CONFIRMED})).toBe(false);
});

test('unknown surfaces, capabilities and roles are refused', () => {
  expect(canPerform('desktop' as unknown as ClientSurface, 'read_repository', {role: 'admin'})).toBe(false);
  expect(canPerform('web', 'fork_repository' as unknown as ClientCapability, {role: 'admin'})).toBe(false);
  expect(canPerform('web', 'read_repository', {role: 'owner' as unknown as Role})).toBe(false);
});

test('each surface admits exactly its per-minute limit within one window', () => {
  expect(CLIENT_REQUESTS_PER_MINUTE).toEqual({api: 600, cli: 300, web: 1200});
  for (const surface of CLIENT_SURFACES) {
    const budget = createClientRequestBudget({now: () => 0});
    let allowed = 0;
    for (let attempt = 0; attempt < 1500; attempt++) if (budget.consume(surface).allowed) allowed += 1;
    expect(allowed).toBe(CLIENT_REQUESTS_PER_MINUTE[surface]);
  }
});

test('a refused request reports the seconds left in the current minute', () => {
  let now = 120_000;
  const budget = createClientRequestBudget({now: () => now});
  for (let attempt = 0; attempt < 300; attempt++) expect(budget.consume('cli')).toEqual({allowed: true, retryAfterSeconds: 0});
  expect(budget.consume('cli')).toEqual({allowed: false, retryAfterSeconds: 60});
  now = 150_250;
  expect(budget.consume('cli')).toEqual({allowed: false, retryAfterSeconds: 30});
});

test('a window rolls over at the next minute and restores the full allowance', () => {
  let now = 0;
  const budget = createClientRequestBudget({now: () => now});
  for (let attempt = 0; attempt < 600; attempt++) expect(budget.consume('api').allowed).toBe(true);
  expect(budget.consume('api').allowed).toBe(false);
  now = 59_999;
  expect(budget.consume('api')).toEqual({allowed: false, retryAfterSeconds: 1});
  now = 60_000;
  expect(budget.consume('api')).toEqual({allowed: true, retryAfterSeconds: 0});
  for (let attempt = 1; attempt < 600; attempt++) expect(budget.consume('api').allowed).toBe(true);
  expect(budget.consume('api').allowed).toBe(false);
});

test('exhausting one surface leaves the others untouched', () => {
  const budget = createClientRequestBudget({now: () => 0});
  for (let attempt = 0; attempt < 300; attempt++) budget.consume('cli');
  expect(budget.consume('cli').allowed).toBe(false);
  expect(budget.consume('web').allowed).toBe(true);
  expect(budget.consume('api').allowed).toBe(true);
});

test('the budget refuses an unknown surface or a clock that does not return a finite time', () => {
  const budget = createClientRequestBudget({now: () => 0});
  expect(() => budget.consume('desktop' as unknown as ClientSurface)).toThrow(RangeError);
  expect(() => createClientRequestBudget({now: () => Number.NaN}).consume('web')).toThrow(RangeError);
});

test('an interactive control needs an allowed role and a non-blank label', () => {
  expect(checkWebInteractiveElement({role: 'button', label: 'Merge pull request'})).toEqual({ok: true});
  expect(checkWebInteractiveElement({role: 'button', label: '   '})).toEqual({ok: false, reason: 'missing_label'});
  expect(checkWebInteractiveElement({role: 'link'})).toEqual({ok: false, reason: 'missing_label'});
  expect(checkWebInteractiveElement({role: 'textbox', label: null})).toEqual({ok: false, reason: 'missing_label'});
});

test('a role outside the interactive set is refused, even when it has a label', () => {
  expect(checkWebInteractiveElement({role: 'div', label: 'Merge'})).toEqual({ok: false, reason: 'role_not_allowed'});
  expect(checkWebInteractiveElement({role: 'heading', label: 'Reviews'})).toEqual({ok: false, reason: 'role_not_allowed'});
  expect(checkWebInteractiveElement({role: '', label: ''})).toEqual({ok: false, reason: 'role_not_allowed'});
});

test('every allowed interactive role passes with a label', () => {
  for (const role of WEB_INTERACTIVE_ROLES) expect(checkWebInteractiveElement({role, label: 'Control'})).toEqual({ok: true});
});
