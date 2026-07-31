'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface ColorPaletteEntry {
  id: string;
  name: string;
  hex: string;
}

export interface ColorPaletteContextValue {
  entries: ColorPaletteEntry[];
  openPalette: (onSelect: (hex: string) => void) => void;
  refreshPalette: () => Promise<void>;
  savePalette: (entries: ColorPaletteEntry[]) => Promise<void>;
}

const ColorPaletteContext = createContext<ColorPaletteContextValue | null>(null);

export function ColorPaletteProvider({
  value,
  children,
}: {
  value: ColorPaletteContextValue;
  children: ReactNode;
}): ReactNode {
  return <ColorPaletteContext.Provider value={value}>{children}</ColorPaletteContext.Provider>;
}

export function useColorPalette(): ColorPaletteContextValue | null {
  return useContext(ColorPaletteContext);
}
