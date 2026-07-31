import { describe, expect, it } from 'vitest';
import { backgroundToStyle, normalizeBackground } from './background.js';

describe('background types', () => {
  it('normalizes legacy color strings', () => {
    expect(normalizeBackground('#ff0000')).toEqual({ kind: 'solid', color: '#ff0000' });
    expect(normalizeBackground('transparent')).toEqual({ kind: 'none' });
  });

  it('maps solid background to CSS', () => {
    expect(backgroundToStyle({ kind: 'solid', color: '#112233' }).style).toEqual({
      backgroundColor: '#112233',
    });
  });

  it('maps gradient background to CSS', () => {
    const { style } = backgroundToStyle({
      kind: 'gradient',
      gradientFrom: '#fff',
      gradientTo: '#000',
      gradientAngle: 90,
    });
    expect(style.background).toBe('linear-gradient(90deg, #fff, #000)');
  });

  it('resolves library image asset URLs', () => {
    const { style } = backgroundToStyle(
      { kind: 'image', imageSource: 'library', imageAssetId: 'asset-1' },
      { 'asset-1': { url: '/assets/file/asset-1' } },
      'http://localhost:3001',
    );
    expect(style.backgroundImage).toContain('http://localhost:3001/assets/file/asset-1');
  });
});
