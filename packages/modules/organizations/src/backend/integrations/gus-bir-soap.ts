/**
 * Feature 173 — the GUS BIR1.1 wire format, without an XML dependency
 * (`specs/173-registration-registry-lookup/contracts/gus-bir11-client.md`
 * §2–§3, research R-4, R-5).
 *
 * Three fixed SOAP 1.2 envelopes built from template strings, and a minimal
 * extractor for the answers. The answers come from a fixed host with a fixed
 * flat schema, and the client reads fewer than twenty leaf names, so this is a
 * few lines a fixture suite covers completely rather than a parser.
 *
 * **What makes it safe**: a body over 256 KB, or one carrying `<!DOCTYPE` or
 * `<!ENTITY`, is refused before anything is read, so entity expansion is
 * impossible by construction; only the five predefined entities and numeric
 * character references are decoded, once per layer.
 */

export const GUS_ENDPOINTS = {
  production: 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc',
  test: 'https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc',
} as const;
export type GusEnvironment = keyof typeof GUS_ENDPOINTS;

export const GUS_MAX_BODY_BYTES = 256 * 1024;
export const GUS_SOAP_CONTENT_TYPE = 'application/soap+xml; charset=utf-8';

const NS_PUBL = 'http://CIS/BIR/PUBL/2014/07';
const ACTION_PUBL = `${NS_PUBL}/IUslugaBIRzewnPubl`;

/** The extractor could not read the body; the client answers `unavailable` / `invalid_response`. */
export class GusSoapError extends Error {
  readonly kind = 'invalid_response' as const;
  constructor(reason: string) {
    super(`invalid_response: ${reason}`);
    this.name = 'GusSoapError';
  }
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const PREDEFINED: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** One layer of decoding: `&lt; &gt; &amp; &quot; &apos;`, `&#N;` and `&#xH;`. Anything else stays as written. */
export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (whole, entity: string) => {
    if (entity.startsWith('#x')) return codePoint(Number.parseInt(entity.slice(2), 16), whole);
    if (entity.startsWith('#')) return codePoint(Number.parseInt(entity.slice(1), 10), whole);
    return PREDEFINED[entity] ?? whole;
  });
}

function codePoint(value: number, fallback: string): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : fallback;
}

function header(endpoint: string, action: string): string[] {
  return [
    '  <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">',
    `    <wsa:To>${escapeXml(endpoint)}</wsa:To>`,
    `    <wsa:Action>${action}</wsa:Action>`,
    '  </soap:Header>',
  ];
}

export function zalogujEnvelope(endpoint: string, key: string): string {
  return [
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="${NS_PUBL}">`,
    ...header(endpoint, `${ACTION_PUBL}/Zaloguj`),
    `  <soap:Body><ns:Zaloguj><ns:pKluczUzytkownika>${escapeXml(key)}</ns:pKluczUzytkownika></ns:Zaloguj></soap:Body>`,
    '</soap:Envelope>',
  ].join('\n');
}

/** `nip` is ten digits after normalisation and needs no escaping; it is escaped anyway. */
export function daneSzukajPodmiotyEnvelope(endpoint: string, nip: string): string {
  return [
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="${NS_PUBL}" xmlns:dat="${NS_PUBL}/DataContract">`,
    ...header(endpoint, `${ACTION_PUBL}/DaneSzukajPodmioty`),
    '  <soap:Body>',
    `    <ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania><dat:Nip>${escapeXml(nip)}</dat:Nip></ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty>`,
    '  </soap:Body>',
    '</soap:Envelope>',
  ].join('\n');
}

export function getValueEnvelope(endpoint: string, name: 'KomunikatKod' | 'StatusSesji'): string {
  return [
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/2014/07">',
    ...header(endpoint, 'http://CIS/BIR/2014/07/IUslugaBIR/GetValue'),
    `  <soap:Body><ns:GetValue><ns:pNazwaParametru>${name}</ns:pNazwaParametru></ns:GetValue></soap:Body>`,
    '</soap:Envelope>',
  ].join('\n');
}

export type GusResultElement = 'ZalogujResult' | 'DaneSzukajPodmiotyResult' | 'GetValueResult';

/**
 * The decoded text of one result element of a SOAP answer, `''` when the
 * element is self-closing. The body may be MTOM (`multipart/related`): the
 * envelope is cut from its first `<…Envelope` to the last matching close tag,
 * whatever the outer framing (research R-4).
 */
export function readSoapResult(body: string, element: GusResultElement): string {
  if (Buffer.byteLength(body, 'utf8') > GUS_MAX_BODY_BYTES) throw new GusSoapError('body too large');
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new GusSoapError('document type declaration');

  const open = /<([A-Za-z_][\w.-]*:)?Envelope[\s>/]/.exec(body);
  if (!open) throw new GusSoapError('no envelope');
  const closeTag = `</${open[1] ?? ''}Envelope>`;
  const close = body.lastIndexOf(closeTag);
  if (close < open.index) throw new GusSoapError('unterminated envelope');
  const envelope = body.slice(open.index, close + closeTag.length);

  const selfClosing = new RegExp(`<(?:[\\w.-]+:)?${element}(?:\\s[^>]*)?/>`).exec(envelope);
  const withText = new RegExp(
    `<(?:[\\w.-]+:)?${element}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${element}>`,
  ).exec(envelope);
  if (withText && (!selfClosing || withText.index < selfClosing.index)) return decodeXmlEntities(withText[1]!);
  if (selfClosing) return '';
  throw new GusSoapError(`no ${element}`);
}

/**
 * The `<dane>` blocks of a decoded search document, each as a map of its
 * leaves — `<Name>value</Name>` decoded and trimmed, `<Name/>` and `<Name />`
 * as `''`. Registry order is kept.
 */
export function readDaneUnits(document: string): Array<Record<string, string>> {
  const units: Array<Record<string, string>> = [];
  for (const block of document.matchAll(/<dane>([\s\S]*?)<\/dane>/g)) {
    const unit: Record<string, string> = {};
    for (const leaf of block[1]!.matchAll(/<(\w+)\s*\/>|<(\w+)>([^<]*)<\/\2>/g)) {
      if (leaf[1] !== undefined) unit[leaf[1]] = '';
      else unit[leaf[2]!] = decodeXmlEntities(leaf[3]!).trim();
    }
    units.push(unit);
  }
  return units;
}
