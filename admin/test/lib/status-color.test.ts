import { describe, expect, it } from 'vitest';
import { readableTextColor, statusBadgeStyle } from '@endora-commerce/admin-kit/lib';

/**
 * A status or tag badge is text on a colour an operator picked, so its
 * legibility is the helper's to guarantee: WCAG 2.2 SC 1.4.3 asks for 4.5:1,
 * and no screen can check a colour that does not exist yet.
 */

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const int = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((int >> 16) & 0xff) + 0.7152 * channel((int >> 8) & 0xff) + 0.0722 * channel(int & 0xff)
  );
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('status badge colours', () => {
  it('keeps the text at 4.5:1 on the colours the platform seeds', () => {
    // The six default opportunity statuses and the palette's mid-tones — the
    // ones a luminance threshold gets wrong: white on amber, green and blue.
    for (const hex of ['#64748b', '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#2563eb', '#d97706']) {
      expect(contrast(readableTextColor(hex), hex), hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the text at 4.5:1 on any colour at all', () => {
    const failing: string[] = [];
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          const hex = `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
          if (contrast(readableTextColor(hex), hex) < 4.5) failing.push(hex);
        }
      }
    }
    expect(failing).toEqual([]);
  });

  it('still answers white on a dark colour and a dark text on a light one, and a full style', () => {
    expect(readableTextColor('#111827')).toBe('#ffffff');
    expect(readableTextColor('#fde68a')).not.toBe('#ffffff');
    expect(statusBadgeStyle('#10b981')).toEqual({
      backgroundColor: '#10b981',
      color: readableTextColor('#10b981'),
      borderColor: 'transparent',
    });
    // An unset or malformed colour falls back rather than throwing.
    expect(statusBadgeStyle('teal').backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
