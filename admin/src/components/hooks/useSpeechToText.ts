import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Thin wrapper around the browser Web Speech API (`SpeechRecognition` /
 * `webkitSpeechRecognition`) for dictating into a text input. Feature-detected:
 * `supported` is false on browsers without the API, so callers render nothing.
 *
 * Final transcripts are pushed to `onTranscript`; the caller decides whether to
 * append or replace. One short utterance per start (continuous = false) keeps
 * the UX predictable inside the command palette.
 */

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechToText {
  /** True when the browser exposes the Web Speech API. */
  supported: boolean;
  /** True while a recognition session is active. */
  listening: boolean;
  /** Start if idle, stop if listening. */
  toggle: () => void;
  /** Stop an active session (no-op when idle). */
  stop: () => void;
}

export function useSpeechToText(opts: {
  onTranscript: (text: string) => void;
  lang?: string;
}): UseSpeechToText {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // Keep the latest callback without re-creating start().
  const onTranscriptRef = useRef(opts.onTranscript);
  onTranscriptRef.current = opts.onTranscript;
  const lang = opts.lang;

  const stop = useCallback((): void => {
    recRef.current?.stop();
  }, []);

  const start = useCallback((): void => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e): void => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r?.isFinal) text += r[0].transcript;
      }
      const trimmed = text.trim();
      if (trimmed) onTranscriptRef.current(trimmed);
    };
    rec.onerror = (): void => setListening(false);
    rec.onend = (): void => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      // start() throws if already started; reset defensively.
      setListening(false);
      recRef.current = null;
    }
  }, [lang]);

  const toggle = useCallback((): void => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => () => recRef.current?.stop(), []);

  return { supported, listening, toggle, stop };
}
