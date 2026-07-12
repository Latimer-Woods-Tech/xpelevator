/**
 * Unit tests for the org-scoped RESOURCE tenant guards
 * (src/lib/tenant-guard.ts).
 *
 * Root cause this covers: the previous inline mutation checks used
 * `if (existing.orgId && existing.orgId !== userOrgId)`, which SKIPS the guard
 * for global rows (`org_id IS NULL`) — any tenant admin could edit or delete
 * the shared global scenarios/criteria/job titles every other tenant depends
 * on. Mutation now requires an exact org match.
 */

import { describe, it, expect } from 'vitest';
import { canMutateResource, canReadResource } from '@/lib/tenant-guard';

describe('canReadResource', () => {
  it('allows anyone to read a global (null-org) resource', () => {
    expect(canReadResource(null, 'orgA')).toBe(true);
    expect(canReadResource(undefined, null)).toBe(true);
  });

  it('allows reading a resource in the viewer\'s own org', () => {
    expect(canReadResource('orgA', 'orgA')).toBe(true);
  });

  it('DENIES reading another org\'s resource', () => {
    expect(canReadResource('orgB', 'orgA')).toBe(false);
    expect(canReadResource('orgB', null)).toBe(false);
  });
});

describe('canMutateResource', () => {
  it('allows an org admin to mutate their own org\'s resource', () => {
    expect(canMutateResource('orgA', 'orgA')).toBe(true);
  });

  it('DENIES a tenant admin mutating a GLOBAL resource (the shared-catalog hole)', () => {
    expect(canMutateResource(null, 'orgA')).toBe(false);
    expect(canMutateResource(undefined, 'orgA')).toBe(false);
  });

  it('DENIES mutating another org\'s resource', () => {
    expect(canMutateResource('orgB', 'orgA')).toBe(false);
  });

  it('allows a platform (null-org) admin to manage the global catalog', () => {
    expect(canMutateResource(null, null)).toBe(true);
    expect(canMutateResource(undefined, null)).toBe(true);
  });

  it('DENIES a platform (null-org) admin mutating a tenant\'s resource', () => {
    expect(canMutateResource('orgA', null)).toBe(false);
  });
});
