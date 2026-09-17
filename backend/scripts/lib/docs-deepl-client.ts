import type { SourceLanguageCode, TargetLanguageCode } from 'deepl-node';

/** Minimal translator surface — mock in unit tests; DeepL in maintainer runs. */
export interface DocsTextTranslator {
  translateTexts(texts: readonly string[], targetLocale: string): Promise<readonly string[]>;
}

const DEEPL_TARGET_LOCALES: Readonly<Record<string, TargetLanguageCode>> = {
  pl: 'pl',
};

function deeplTargetLanguage(locale: string): TargetLanguageCode {
  const target = DEEPL_TARGET_LOCALES[locale];
  if (target === undefined) {
    throw new Error(`[docs-translate] no DeepL target language mapping for locale ${locale}.`);
  }
  return target;
}

/** DeepL-backed translator using `DEEPL_API_KEY` from the environment. */
export async function createDeepLTranslator(): Promise<DocsTextTranslator> {
  const apiKey = process.env.DEEPL_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error(
      '[docs-translate] DEEPL_API_KEY is not set — machine translation runs on a maintainer machine only.',
    );
  }
  const { Translator } = await import('deepl-node');
  const translator = new Translator(apiKey);
  return {
    async translateTexts(texts, targetLocale) {
      if (texts.length === 0) {
        return [];
      }
      const results = await translator.translateText(
        [...texts],
        'en' as SourceLanguageCode,
        deeplTargetLanguage(targetLocale),
      );
      const translated = Array.isArray(results) ? results : [results];
      return translated.map((entry) => entry.text);
    },
  };
}
