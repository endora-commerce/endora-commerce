import { describe, expect, it } from 'vitest';
import {
  countConfiguredSlugs,
  estimateCategoryGridSkeletonCount,
  estimateCategoryListSkeletonCount,
  estimateProductGridSkeletonCount,
  estimateProductSliderSkeletonCount,
} from './catalog-skeleton-estimate.js';

describe('catalog-skeleton-estimate', () => {
  it('counts trimmed manual slugs', () => {
    expect(countConfiguredSlugs(['a', ' ', 'b'])).toBe(2);
  });

  it('uses manual category count for grid skeleton', () => {
    expect(estimateCategoryGridSkeletonCount('manual', ['one', 'two'], 4)).toBe(2);
  });

  it('falls back to one grid row when category count is unknown', () => {
    expect(estimateCategoryGridSkeletonCount('all', [], 4)).toBe(4);
  });

  it('uses manual category count for list skeleton', () => {
    expect(estimateCategoryListSkeletonCount('manual', ['one', 'two', 'three'])).toBe(3);
  });

  it('uses manual product count for grid skeleton', () => {
    expect(estimateProductGridSkeletonCount('manual', ['a', 'b', 'c'], 12, 4)).toBe(3);
  });

  it('caps slider skeleton count by limit', () => {
    expect(estimateProductSliderSkeletonCount('manual', ['a', 'b', 'c', 'd', 'e'], 3, 2)).toBe(3);
  });
});
