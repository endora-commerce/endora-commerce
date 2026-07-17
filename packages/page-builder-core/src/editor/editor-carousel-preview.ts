'use client';

import { useEffect } from 'react';
import { useGetPuck } from '@measured/puck';
import { usePageBuilderPuck } from './use-page-builder-puck.js';
import {
  getEditorCarouselPageFromUi,
  readEditorCarouselPages,
  type EditorCarouselPreviewUi,
} from './editor-carousel-preview-ui.js';

type CarouselPageWriter = (carouselId: string, page: number) => void;

let carouselPageWriter: CarouselPageWriter | null = null;

/**
 * Survives ActionBar remounts when the selected slide is hidden by preview CSS.
 * While locked, selection→page sync must not snap the preview back.
 */
type PreviewPageLock = {
  frozenSelectedId: string | null;
};

const previewPageLocks = new Map<string, PreviewPageLock>();
const lastSeenSelectedIdByCarousel = new Map<string, string | null>();

export function registerEditorCarouselPageWriter(writer: CarouselPageWriter | null): void {
  carouselPageWriter = writer;
}

export function isEditorCarouselPreviewLocked(carouselId: string): boolean {
  return previewPageLocks.has(carouselId);
}

export function getEditorCarouselPreviewFrozenSelectedId(carouselId: string): string | null {
  return previewPageLocks.get(carouselId)?.frozenSelectedId ?? null;
}

export function getEditorCarouselLastSeenSelectedId(carouselId: string): string | null {
  return lastSeenSelectedIdByCarousel.get(carouselId) ?? null;
}

export function clearEditorCarouselPreviewLock(carouselId: string): void {
  previewPageLocks.delete(carouselId);
}

/** Remember selection without changing the preview page (updates freeze when locked). */
export function rememberEditorCarouselSelectedId(
  carouselId: string,
  selectedId: string | null,
): void {
  lastSeenSelectedIdByCarousel.set(carouselId, selectedId);
  const lock = previewPageLocks.get(carouselId);
  if (lock) {
    previewPageLocks.set(carouselId, { frozenSelectedId: selectedId });
  }
}

/**
 * Sets the editor preview page.
 * Default `lock: true` so selection sync cannot snap the page back after arrow/dot nav.
 */
export function setEditorCarouselPage(
  carouselId: string,
  page: number,
  options?: { lock?: boolean; frozenSelectedId?: string | null },
): void {
  const next = Math.max(0, Math.trunc(page));
  const shouldLock = options?.lock !== false;
  if (shouldLock) {
    const prev = previewPageLocks.get(carouselId);
    const frozen =
      options?.frozenSelectedId !== undefined
        ? options.frozenSelectedId
        : (prev?.frozenSelectedId ?? lastSeenSelectedIdByCarousel.get(carouselId) ?? null);
    previewPageLocks.set(carouselId, { frozenSelectedId: frozen });
    if (options?.frozenSelectedId !== undefined) {
      lastSeenSelectedIdByCarousel.set(carouselId, options.frozenSelectedId);
    }
  } else {
    previewPageLocks.delete(carouselId);
    if (options?.frozenSelectedId !== undefined) {
      lastSeenSelectedIdByCarousel.set(carouselId, options.frozenSelectedId);
    }
  }
  carouselPageWriter?.(carouselId, next);
}

export function clampEditorCarouselPage(carouselId: string, pageCount: number): void {
  void carouselId;
  void pageCount;
}

/** @deprecated Prefer {@link useEditorCarouselPage}. */
export function getEditorCarouselPage(carouselId: string): number {
  void carouselId;
  return 0;
}

/** Active carousel page — stored on Puck `appState.ui` (shared by canvas + action bar). */
export function useEditorCarouselPage(carouselId: string | undefined): number {
  return usePageBuilderPuck((state) => {
    if (!carouselId) return 0;
    const ui = state.appState.ui as EditorCarouselPreviewUi;
    return getEditorCarouselPageFromUi(ui, carouselId);
  });
}

/** Registers the Puck writer used by `setEditorCarouselPage` — mount inside `<Puck>`. */
export function EditorCarouselPreviewBridge(): null {
  const dispatch = usePageBuilderPuck((s) => s.dispatch);
  const getPuck = useGetPuck();

  useEffect(() => {
    registerEditorCarouselPageWriter((carouselId, page) => {
      const ui = getPuck().appState.ui as EditorCarouselPreviewUi;
      const pages = readEditorCarouselPages(ui);
      if ((pages[carouselId] ?? 0) === page) return;
      dispatch({
        type: 'setUi',
        // Custom key — not on Puck's UiState type; stored alongside built-in UI state.
        ui: {
          carouselPreviewPages: { ...pages, [carouselId]: page },
        } as EditorCarouselPreviewUi as never,
        recordHistory: false,
      });
    });
    return (): void => registerEditorCarouselPageWriter(null);
  }, [dispatch, getPuck]);

  return null;
}

/** @deprecated Slide counts come from Puck data in the action bar. */
export function setEditorCarouselSlideCount(_carouselId: string, _slideCount: number): void {}

/** @deprecated Slide counts come from Puck data in the action bar. */
export function getEditorCarouselSlideCount(_carouselId: string): number | undefined {
  return undefined;
}

/** @deprecated */
export function subscribeEditorCarouselPreview(_listener: () => void): () => void {
  return (): void => {};
}

export {
  carouselEditorPageCount,
  getEditorCarouselPageFromUi,
  readEditorCarouselPages,
  type EditorCarouselPreviewUi,
} from './editor-carousel-preview-ui.js';
