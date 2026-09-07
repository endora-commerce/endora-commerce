import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CmsColorPaletteEntry, PutCmsColorPaletteRequest } from '@endora-commerce/contracts';
import { ColorPaletteProvider as PbColorPaletteProvider } from '@endora-commerce/page-builder-core/client';
import { getPageBuilderColorPalette, putPageBuilderColorPalette } from './cms-page-builder-api.js';
import { ColorPaletteModal } from './ColorPaletteModal.js';

export function PageBuilderColorPaletteProvider({
  initialEntries,
  children,
}: {
  initialEntries: CmsColorPaletteEntry[];
  children: ReactNode;
}): ReactNode {
  const [entries, setEntries] = useState<CmsColorPaletteEntry[]>(initialEntries);
  const [modalOpen, setModalOpen] = useState(false);
  const [pickHandler, setPickHandler] = useState<((hex: string) => void) | null>(null);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  const refreshPalette = useCallback(async (): Promise<void> => {
    setEntries(await getPageBuilderColorPalette());
  }, []);

  const savePalette = useCallback(async (next: CmsColorPaletteEntry[]): Promise<void> => {
    const body: PutCmsColorPaletteRequest = { entries: next };
    const result = await putPageBuilderColorPalette(body);
    setEntries(result.entries);
  }, []);

  const openPalette = useCallback((onSelect: (hex: string) => void): void => {
    setPickHandler(() => onSelect);
    setModalOpen(true);
  }, []);

  const contextValue = useMemo(
    () => ({
      entries,
      openPalette,
      refreshPalette,
      savePalette,
    }),
    [entries, openPalette, refreshPalette, savePalette],
  );

  return (
    <PbColorPaletteProvider value={contextValue}>
      {children}
      <ColorPaletteModal
        open={modalOpen}
        entries={entries}
        pickMode={pickHandler !== null}
        onClose={(): void => {
          setModalOpen(false);
          setPickHandler(null);
        }}
        onPick={(hex): void => {
          pickHandler?.(hex);
          setModalOpen(false);
          setPickHandler(null);
        }}
        onSave={savePalette}
      />
    </PbColorPaletteProvider>
  );
}
