/**
 * Unit tests for the capability schema helpers — round-tripping between the
 * console-facing `{ id, fields, enabled }` view and the on-disk
 * `CapabilityConfig` blob.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCapabilityView,
  buildConfigFromPayload,
  findCapability,
} from '../../src/capabilities/schema.js';
import { githubCapability } from '../../src/capabilities/github.js';
import { cloudwatchCapability } from '../../src/capabilities/cloudwatch.js';
import type { CapabilityConfig } from '../../src/capabilities/types.js';

describe('buildCapabilityView', () => {
  it('returns one field per declared schema entry, with empty value when unconfigured', () => {
    const view = buildCapabilityView(githubCapability, null, undefined);
    expect(view.id).toBe('github');
    expect(view.enabled).toBe(false);
    expect(view.fields.map((f) => f.key).sort()).toEqual(['defaultRepo', 'repos', 'token']);
    for (const f of view.fields) expect(f.value).toBe('');
  });

  it('hydrates field values from credentials and settings', () => {
    const stored: CapabilityConfig = {
      enabled: true,
      credentials: { token: 'ghp_abc' },
      settings: { defaultRepo: 'kn-eng/kn-eng', repos: ['kn-eng/kn-eng', 'kn-eng/other'] },
    };
    const view = buildCapabilityView(githubCapability, stored, 1234);
    expect(view.enabled).toBe(true);
    expect(view.updatedAt).toBe(1234);
    const tokenField = view.fields.find((f) => f.key === 'token')!;
    expect(tokenField.value).toBe('ghp_abc');
    expect(tokenField.secret).toBe(true);
    const reposField = view.fields.find((f) => f.key === 'repos')!;
    // string[] kind is rendered as comma-separated for the input
    expect(reposField.value).toBe('kn-eng/kn-eng, kn-eng/other');
  });
});

describe('buildConfigFromPayload', () => {
  it('reconstructs a CapabilityConfig from the schema-driven fields payload', () => {
    const payload = {
      enabled: true,
      fields: [
        { key: 'token', value: 'ghp_xyz' },
        { key: 'defaultRepo', value: 'foo/bar' },
        { key: 'repos', value: 'foo/bar, foo/baz\nfoo/qux' },
      ],
    };
    const next = buildConfigFromPayload(githubCapability, payload, null);
    expect(next.enabled).toBe(true);
    expect(next.credentials.token).toBe('ghp_xyz');
    expect(next.settings['defaultRepo']).toBe('foo/bar');
    expect(next.settings['repos']).toEqual(['foo/bar', 'foo/baz', 'foo/qux']);
  });

  it('drops empty values rather than writing empty strings', () => {
    const next = buildConfigFromPayload(
      githubCapability,
      { enabled: false, fields: [{ key: 'token', value: '' }] },
      null,
    );
    expect(next.credentials).not.toHaveProperty('token');
  });

  it('preserves unknown keys (e.g. findWork, awsProfile) from the existing blob', () => {
    const existing: CapabilityConfig = {
      enabled: true,
      credentials: {},
      settings: { awsProfile: 'dev', logGroups: ['/aws/foo'] },
      findWork: { enabled: true, intervalMinutes: 30 },
    };
    const next = buildConfigFromPayload(
      cloudwatchCapability,
      { enabled: true, fields: [{ key: 'logGroups', value: '/aws/bar' }] },
      existing,
    );
    expect(next.settings['awsProfile']).toBe('dev');
    expect(next.settings['logGroups']).toEqual(['/aws/bar']);
    expect(next.findWork?.enabled).toBe(true);
    expect(next.findWork?.intervalMinutes).toBe(30);
  });

  it('passes through legacy raw {credentials, settings} blob shape', () => {
    const next = buildConfigFromPayload(
      githubCapability,
      {
        enabled: true,
        credentials: { token: 'ghp_legacy' },
        settings: { defaultRepo: 'a/b' },
      },
      null,
    );
    expect(next.credentials.token).toBe('ghp_legacy');
    expect(next.settings['defaultRepo']).toBe('a/b');
  });
});

describe('findCapability', () => {
  it('finds known capabilities by id', () => {
    expect(findCapability('github')?.id).toBe('github');
    expect(findCapability('cloudwatch')?.id).toBe('cloudwatch');
  });
  it('returns null for unknown ids', () => {
    expect(findCapability('nope')).toBeNull();
  });
});
