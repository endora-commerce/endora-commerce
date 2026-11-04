import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { UrlKeysPanel } from '../../../../packages/modules/blog/src/admin/components/UrlKeysPanel';

/**
 * Feature 171 (US4, T064) — the editor sets a post's URL key in the language being
 * edited; a key another entry still answers as a redirect is saved only after the
 * editor confirms the takeover.
 */

const en = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/blog/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const core = JSON.parse(readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8')) as Record<
  string,
  string
>;

const POST_ID = '66666666-2222-4333-8444-555555555555';
const KEYS = {
  slug: 'wiertarki',
  keys: [],
  effective: [{ salesChannelId: '11111111-2222-4333-8444-555555555555', languageCode: 'en-US', key: 'wiertarki', path: '/en/blog/wiertarki' }],
  redirects: [],
  version: 3,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UrlKeysPanel (feature 171)', () => {
  it('saves the key of the language being edited, and confirms a takeover before saving it', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: KEYS });
    const put = vi
      .spyOn(apiClient, 'put')
      .mockRejectedValueOnce(
        new ApiError(409, { error: { code: 'BLOG_URL_KEY_REDIRECT_TAKEOVER_REQUIRED', message: 'confirm' } } as never),
      )
      .mockResolvedValueOnce({ data: { ...KEYS, keys: [{ languageCode: 'en-US', key: 'drills' }], version: 4 } });
    const onSaved = vi.fn();

    renderWithI18n(<UrlKeysPanel kind="post" entityId={POST_ID} language="en-US" onSaved={onSaved} />, { blog: en, core });
    const input = await screen.findByPlaceholderText('wiertarki');
    expect(await screen.findByText('/en/blog/wiertarki')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'drills' } });
    fireEvent.click(screen.getByRole('button', { name: en['urlKeys.save']! }));

    fireEvent.click(await screen.findByRole('button', { name: en['urlKeys.takeoverConfirm']! }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(put.mock.calls[0]![1]).toEqual({ keys: [{ languageCode: 'en-US', key: 'drills' }], version: 3 });
    expect(put.mock.calls[1]![1]).toEqual({
      keys: [{ languageCode: 'en-US', key: 'drills' }],
      confirmTakeover: [{ languageCode: 'en-US', key: 'drills' }],
      version: 3,
    });
    expect(put.mock.calls[1]![0]).toBe(`/api/v1/admin/blog/posts/${POST_ID}/url-keys`);
  });
});
