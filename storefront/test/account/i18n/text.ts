/**
 * The text a server render shows a reader — tags dropped, React's text-node
 * separators removed, the entities `renderToString` writes decoded and runs of
 * whitespace collapsed — so an assertion reads the sentence the buyer sees.
 */
export function visibleText(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    // Inline elements sit inside a sentence ("Order <strong>X</strong>."); block ones end a run of text.
    .replace(/<\/?(?:strong|b|em|i|a|span|small|code)(?:\s[^>]*)?>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Any Polish diacritic — an English render must carry none. */
export const POLISH_DIACRITIC = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

/**
 * The text without the zloty sign (`z\u0142`). A PLN amount keeps its currency's own
 * conventions in every language (`formatMoney`'s default), so `zł` is the
 * currency speaking, not the page language — and would trip the diacritic check.
 */
export function withoutZloty(text: string): string {
  return text.replace(/zł/g, '');
}
