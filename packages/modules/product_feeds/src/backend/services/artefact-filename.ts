/**
 * The filename a generated artefact carries — feature 067, extended by 070.
 *
 * Lifted out of `routes.admin.ts` when feed delivery arrived, because the name a
 * partner's SFTP directory receives and the name an operator's browser
 * downloads must be the same string. Two copies of this mapping would drift the
 * first time a format was added, and the operator would be the one to find out.
 *
 * That move also fixed the two formats the original map did not know about:
 * `xlsx` and `txt` both resolved to `.xml`, so a spreadsheet feed downloaded as
 * an XML file that Excel refused to open.
 */

/** Media type → file extension, for every format the serializers emit. */
export function extensionFor(contentType: string): string {
  const type = contentType.toLowerCase();
  if (type.startsWith('text/tab-separated-values')) return 'tsv';
  if (type.startsWith('text/csv')) return 'csv';
  if (type.startsWith('text/plain')) return 'txt';
  if (type.startsWith('application/vnd.openxmlformats-officedocument.spreadsheetml')) {
    return 'xlsx';
  }
  return 'xml';
}

/** `<slug>.<ext>` — the name the file takes on a delivery target and in a download. */
export function artefactFilename(slug: string, contentType: string): string {
  return `${slug}.${extensionFor(contentType)}`;
}
