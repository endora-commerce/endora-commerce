import { describe, expect, it, vi } from 'vitest';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';

import { createSettingsView } from './settings-view.js';

/**
 * A `settingsReadPort` answering from a map: a code that is absent is not
 * registered. Every call is recorded, so a test can say which channel the
 * module asked about.
 */
function portOver(values: Record<string, unknown>) {
  const getMany = vi.fn(async (codes: string[], _salesChannelId: string | null) => {
    const out = new Map<string, { ok: true; value: unknown } | { ok: false; error: 'not_registered' }>();
    for (const code of codes) {
      out.set(code, code in values ? { ok: true, value: values[code] } : { ok: false, error: 'not_registered' });
    }
    return out;
  });
  const port: Pick<SettingsReadPort, 'getMany'> = { getMany };
  return { port, getMany };
}

// specs/156-asset-stable-url/ T032 — the retention a sweep and every reported
// purge date read: at least one day (owner ruling P3).
describe('softDeleteRetentionDays', () => {
  it.each([
    [0, 1],
    [0.25, 1],
    [7.5, 7.5],
    [14, 14],
    [-1, 30],
    [Infinity, 30],
    ['x', 30],
    // Block review F: an empty or non-numeric value applies as 30, never as 0.
    ['', 30],
    ['   ', 30],
    [null, 30],
    [true, 30],
    [[], 30],
    [{}, 30],
    ['7', 7],
  ] as const)('answers %s as %s', async (value, days) => {
    const { port } = portOver({ 'assets.soft_delete_retention_days': value });
    expect(await createSettingsView(port).softDeleteRetentionDays()).toBe(days);
  });

  it('answers 30 for a missing setting', async () => {
    expect(await createSettingsView(portOver({}).port).softDeleteRetentionDays()).toBe(30);
  });
});

// Issue #333 — every `assets.*` setting is platform-wide: it is read through
// the platform's settings read with no sales channel, which answers
// `global_value ?? default_value` and never a per-channel row.
describe('platform-wide reads (#333)', () => {
  it('asks for every setting with no sales channel', async () => {
    const { port, getMany } = portOver({
      'assets.storage.adapter': 's3',
      'assets.local.base_dir': '/srv/assets',
      'assets.local.public_url_base': '',
      'assets.private_url_ttl_sec': 60,
      'assets.soft_delete_retention_days': 7,
      'assets.allowed_file_types': ['png'],
      'assets.max_file_size_mb': 5,
    });
    const view = createSettingsView(port);
    await view.activeAdapter();
    await view.localBaseDir();
    await view.localPublicUrlBase();
    await view.privateUrlTtlSec();
    await view.softDeleteRetentionDays();
    await view.uploadPolicy();
    // Neither cloud configuration is in the map, so both refuse — what is
    // asserted is the channel each read named.
    await expect(view.s3Config()).rejects.toThrow('missing setting');
    await expect(view.gcsConfig()).rejects.toThrow('missing setting');
    expect(getMany).toHaveBeenCalled();
    for (const [, salesChannelId] of getMany.mock.calls) expect(salesChannelId).toBeNull();
  });

  it('answers the adapter the platform read resolves', async () => {
    expect(await createSettingsView(portOver({ 'assets.storage.adapter': ' gcs ' }).port).activeAdapter())
      .toBe('gcs');
  });

  it('answers local for an adapter it does not know', async () => {
    expect(await createSettingsView(portOver({ 'assets.storage.adapter': 'ftp' }).port).activeAdapter())
      .toBe('local');
  });

  it('refuses to guess a missing string setting', async () => {
    await expect(createSettingsView(portOver({}).port).localBaseDir())
      .rejects.toThrow('Assets Library settings: missing setting "assets.local.base_dir".');
  });

  it('names a setting limited to some sales channels rather than calling it missing', async () => {
    const port: Pick<SettingsReadPort, 'getMany'> = {
      getMany: async (codes) => new Map(codes.map((code) => [code, { ok: false, error: 'out_of_scope' } as const])),
    };
    await expect(createSettingsView(port).localBaseDir()).rejects.toThrow(
      '"assets.local.base_dir" is limited to some sales channels and has no platform-wide value',
    );
  });

  it('reads the S3 configuration in one batch', async () => {
    const { port, getMany } = portOver({
      'assets.s3.bucket': 'media',
      'assets.s3.region': 'eu-central-1',
      'assets.s3.access_key_id': 'AKIA-TEST',
      'assets.s3.secret_access_key': 'secret',
      'assets.s3.endpoint': '',
      'assets.s3.prefix': 'p/',
      'assets.s3.public_base_url': '',
    });
    expect(await createSettingsView(port).s3Config()).toEqual({
      bucket: 'media',
      region: 'eu-central-1',
      accessKeyId: 'AKIA-TEST',
      secretAccessKey: 'secret',
      endpoint: '',
      prefix: 'p/',
      publicBaseUrl: '',
    });
    expect(getMany).toHaveBeenCalledOnce();
  });

  it('reads the GCS configuration in one batch', async () => {
    const { port, getMany } = portOver({
      'assets.gcs.bucket': 'media',
      'assets.gcs.service_account_json': '{}',
      'assets.gcs.prefix': '',
      'assets.gcs.public_base_url': 'https://cdn.example.test',
    });
    expect(await createSettingsView(port).gcsConfig()).toEqual({
      bucket: 'media',
      serviceAccountJson: '{}',
      prefix: '',
      publicBaseUrl: 'https://cdn.example.test',
    });
    expect(getMany).toHaveBeenCalledOnce();
  });
});

describe('uploadPolicy', () => {
  it('answers the stored types and limit', async () => {
    const { port } = portOver({ 'assets.allowed_file_types': ['png', 'pdf'], 'assets.max_file_size_mb': 1 });
    expect(await createSettingsView(port).uploadPolicy()).toEqual({
      allowedTypes: ['png', 'pdf'],
      maxFileSizeMb: 1,
    });
  });

  it('answers any type and no limit when neither setting is registered', async () => {
    expect(await createSettingsView(portOver({}).port).uploadPolicy()).toEqual({
      allowedTypes: ['*'],
      maxFileSizeMb: 0,
    });
  });

  it.each(['png', null])('answers any type for a type list stored as %j', async (types) => {
    const { port } = portOver({ 'assets.allowed_file_types': types, 'assets.max_file_size_mb': 0 });
    expect((await createSettingsView(port).uploadPolicy()).allowedTypes).toEqual(['*']);
  });

  it.each([
    ['2', 2],
    ['', 0],
    ['x', 0],
    [null, 0],
  ] as const)('reads a limit stored as %j as %s', async (value, mb) => {
    const { port } = portOver({ 'assets.allowed_file_types': ['*'], 'assets.max_file_size_mb': value });
    expect((await createSettingsView(port).uploadPolicy()).maxFileSizeMb).toBe(mb);
  });
});
