import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GUS_ENDPOINTS,
  GusSoapError,
  daneSzukajPodmiotyEnvelope,
  decodeXmlEntities,
  getValueEnvelope,
  readDaneUnits,
  readSoapResult,
  zalogujEnvelope,
} from './gus-bir-soap.js';

/**
 * Feature 173 (T008; FR-005, research R-5) — hand-built SOAP 1.2 envelopes and
 * the minimal extractor that reads GUS BIR1.1 MTOM answers without an XML
 * dependency. Fixture bodies: synthetic data in captured framing.
 */

/**
 * Synthetic GUS BIR1.1 bodies, `gus-fixture-*.txt` beside this test (a sibling
 * test is what keeps them out of the published package, D-218). The MTOM
 * framing, namespaces, action URIs, the escaped inner document with its `&#xD;`
 * and the self-closing empty leaves are copied from what the T001 spike captured
 * from the GUS **test** environment; every data value is invented.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(here, `gus-fixture-${name}`), 'utf8');
const TEST = GUS_ENDPOINTS.test;

describe('envelopes (contracts/gus-bir11-client.md §2)', () => {
  it('Zaloguj, with the key XML-escaped', () => {
    expect(zalogujEnvelope(TEST, 'a<b&"c\'>')).toBe(
      [
        '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07">',
        '  <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">',
        '    <wsa:To>https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc</wsa:To>',
        '    <wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj</wsa:Action>',
        '  </soap:Header>',
        '  <soap:Body><ns:Zaloguj><ns:pKluczUzytkownika>a&lt;b&amp;&quot;c&apos;&gt;</ns:pKluczUzytkownika></ns:Zaloguj></soap:Body>',
        '</soap:Envelope>',
      ].join('\n'),
    );
  });

  it('DaneSzukajPodmioty', () => {
    expect(daneSzukajPodmiotyEnvelope(GUS_ENDPOINTS.production, '5260250995')).toBe(
      [
        '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07" xmlns:dat="http://CIS/BIR/PUBL/2014/07/DataContract">',
        '  <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">',
        '    <wsa:To>https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc</wsa:To>',
        '    <wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmioty</wsa:Action>',
        '  </soap:Header>',
        '  <soap:Body>',
        '    <ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania><dat:Nip>5260250995</dat:Nip></ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty>',
        '  </soap:Body>',
        '</soap:Envelope>',
      ].join('\n'),
    );
  });

  it('GetValue', () => {
    expect(getValueEnvelope(TEST, 'StatusSesji')).toBe(
      [
        '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/2014/07">',
        '  <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">',
        '    <wsa:To>https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc</wsa:To>',
        '    <wsa:Action>http://CIS/BIR/2014/07/IUslugaBIR/GetValue</wsa:Action>',
        '  </soap:Header>',
        '  <soap:Body><ns:GetValue><ns:pNazwaParametru>StatusSesji</ns:pNazwaParametru></ns:GetValue></soap:Body>',
        '</soap:Envelope>',
      ].join('\n'),
    );
  });
});

describe('decodeXmlEntities', () => {
  it('decodes the five predefined entities and numeric references, once', () => {
    expect(decodeXmlEntities('&lt;a&gt; &amp;amp; &quot;&apos; &#xD;&#10;&#261;&#x0142;')).toBe(
      '<a> &amp; "\' \r\nął',
    );
  });
});

describe('readSoapResult', () => {
  it('cuts the envelope out of the MTOM body and reads the session id', () => {
    expect(readSoapResult(fixture('login-ok.txt'), 'ZalogujResult')).toBe('fixturesid0000000001');
  });

  it('reads a self-closing result as empty', () => {
    expect(readSoapResult(fixture('login-empty.txt'), 'ZalogujResult')).toBe('');
    expect(readSoapResult(fixture('search-empty.txt'), 'DaneSzukajPodmiotyResult')).toBe('');
    expect(readSoapResult(fixture('getvalue-empty.txt'), 'GetValueResult')).toBe('');
    expect(readSoapResult(fixture('getvalue-0.txt'), 'GetValueResult')).toBe('0');
  });

  it('reads a bare envelope, with any namespace prefix', () => {
    const body =
      '<soap:Envelope xmlns:soap="x"><soap:Body><r:GetValueResponse xmlns:r="y"><r:GetValueResult>7</r:GetValueResult></r:GetValueResponse></soap:Body></soap:Envelope>';
    expect(readSoapResult(body, 'GetValueResult')).toBe('7');
  });

  it('decodes the escaped inner document of a search', () => {
    const inner = readSoapResult(fixture('search-found-legal.txt'), 'DaneSzukajPodmiotyResult');
    expect(inner.startsWith('<root>\r\n  <dane>')).toBe(true);
  });

  it('refuses a DTD as invalid_response', () => {
    expect(() => readSoapResult(fixture('search-dtd.txt'), 'DaneSzukajPodmiotyResult')).toThrow(GusSoapError);
    expect(() => readSoapResult('<!ENTITY x "y"><Envelope/>', 'GetValueResult')).toThrow(/invalid_response/);
  });

  it('refuses a body over 256 KB as invalid_response', () => {
    const big = fixture('login-ok.txt') + ' '.repeat(256 * 1024);
    expect(() => readSoapResult(big, 'ZalogujResult')).toThrow(GusSoapError);
  });

  it('refuses a body with no envelope or no result element', () => {
    expect(() => readSoapResult('<html>Service Unavailable</html>', 'ZalogujResult')).toThrow(GusSoapError);
    expect(() => readSoapResult(fixture('login-ok.txt'), 'GetValueResult')).toThrow(GusSoapError);
  });
});

describe('readDaneUnits', () => {
  it('splits <dane> blocks and reads every leaf, empty ones included, decoded and trimmed', () => {
    const units = readDaneUnits(readSoapResult(fixture('search-found-legal.txt'), 'DaneSzukajPodmiotyResult'));
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      Regon: '123456785',
      Nip: '5260250995',
      StatusNip: '',
      Nazwa: 'PRZYKŁADOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ "TEST" & WSPÓLNICY',
      KodPocztowy: '00-001',
      Ulica: 'ul. Testowa',
      NrNieruchomosci: '12',
      NrLokalu: '3A',
      Typ: 'P',
      DataZakonczeniaDzialalnosci: '',
    });
  });

  it('reads the not-found spelling inside <dane> (T001)', () => {
    const units = readDaneUnits(readSoapResult(fixture('search-not-found.txt'), 'DaneSzukajPodmiotyResult'));
    expect(units).toEqual([
      expect.objectContaining({ ErrorCode: '4', Nip: '1234563218' }),
    ]);
  });

  it('reads several units in registry order', () => {
    const units = readDaneUnits(readSoapResult(fixture('search-found-several.txt'), 'DaneSzukajPodmiotyResult'));
    expect(units.map((u) => u['Regon'])).toEqual(['12345678500012', '111111111', '222222222']);
  });

  it('answers no units for an empty document', () => {
    expect(readDaneUnits('')).toEqual([]);
    expect(readDaneUnits('<root>\r\n</root>')).toEqual([]);
  });
});
