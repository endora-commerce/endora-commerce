/**
 * Every name on the admin icon allowlist draws its own glyph.
 *
 * `ICON_MAP` is typed `Record<KnownIconName, LucideIcon>`, so a name with no
 * entry is already a type error. What the type cannot see is an entry mapped
 * to the wrong component, or to `Sparkles` — the fallback an unknown name
 * renders — which would make a declared icon indistinguishable from a missing
 * one. `Sparkles` itself is the one name allowed to resolve to it.
 */
import { describe, expect, it } from 'vitest';
import { CalendarDays, Sparkles } from 'lucide-react';
import { KnownIconNameSchema } from '@endora-commerce/contracts';
import { resolveIcon } from '@endora-commerce/admin-kit/lib';

describe('resolveIcon', () => {
  it('resolves every allowlisted name to a glyph of its own, not the fallback', () => {
    for (const name of KnownIconNameSchema.options) {
      if (name === 'Sparkles') continue;
      expect(resolveIcon(name), name).not.toBe(Sparkles);
    }
  });

  it('draws the calendar glyph for the CRM Calendar entry (specs/143, US22)', () => {
    expect(resolveIcon('CalendarDays')).toBe(CalendarDays);
  });
});
