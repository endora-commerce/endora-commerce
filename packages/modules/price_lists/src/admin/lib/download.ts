/**
 * Hand a text file to the browser as a download (feature 161, US9): a CSV
 * export or a refused-rows file. The text already carries its BOM; the blob
 * says UTF-8 so a spreadsheet opens it as such.
 */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Let the click start the download before the address goes.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
