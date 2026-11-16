import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { assertDocumentAssetsLinkable, documentAssetIds } from './linkable-assets.js';

/**
 * Issue #544 (owner ruling 2026-10-30, option a) — an image a document
 * template names is read as bytes and inlined into the PDF, the preview
 * included. So an asset id a save newly adds, and every id a preview renders,
 * must be one the caller may see in the asset library — a hidden file and a
 * missing one alike.
 */

const VISIBLE = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const HIDDEN = '1b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const STORED = '3b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';

function visibility() {
  const asked: string[][] = [];
  return {
    asked,
    visibleToCaller: async (ids: readonly string[]) => {
      asked.push([...ids]);
      return new Set(ids.filter((id) => id === VISIBLE));
    },
  };
}

describe('documentAssetIds', () => {
  it('reads an asset id prop and a library file URL in a src prop', () => {
    const tree = {
      content: [
        { type: 'Image', props: { assetId: VISIBLE } },
        { type: 'InvoiceLogo', props: { src: `http://localhost:3001/assets/file/${HIDDEN}` } },
        { type: 'InvoiceLogo', props: { src: 'https://cdn.example.com/logo.png' } },
        { type: 'Text', props: { text: `see /assets/file/${STORED}` } },
      ],
    };
    expect([...documentAssetIds(tree)].sort()).toEqual([HIDDEN, VISIBLE].sort());
  });
});

describe('assertDocumentAssetsLinkable', () => {
  it('refuses an id the caller may not see with the library’s answer for a hidden file', async () => {
    const err = await assertDocumentAssetsLinkable(visibility(), { content: [{ type: 'Image', props: { assetId: HIDDEN } }] }, [])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(404);
    expect((err as HttpError).code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
    expect((err as HttpError).message).toBe(`Asset ${HIDDEN} not found.`);
  });

  it('accepts a visible id, and does not ask about one the template already stores', async () => {
    const assets = visibility();
    await assertDocumentAssetsLinkable(
      assets,
      { content: [{ type: 'Image', props: { assetId: VISIBLE } }, { type: 'Image', props: { assetId: STORED } }] },
      [{ languages: { 'pl-PL': { content: [{ type: 'Image', props: { assetId: STORED } }] } } }],
    );
    expect(assets.asked).toEqual([[VISIBLE]]);
  });
});
