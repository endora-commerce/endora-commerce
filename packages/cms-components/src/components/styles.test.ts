import { describe, expect, it } from 'vitest';
import { clampColumnCount } from './styles.js';

describe('clampColumnCount', () => {
  it('clamps to 1–12', () => {
    expect(clampColumnCount(0)).toBe(1);
    expect(clampColumnCount(20)).toBe(12);
    expect(clampColumnCount(4.6)).toBe(5);
  });
});
