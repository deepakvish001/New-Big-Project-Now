/**
 * Minimal RFC 4180 reader: quoted fields, escaped quotes, embedded newlines,
 * and CRLF. Shopify exports hit all four.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  // Strip a UTF-8 BOM, which Excel adds and which otherwise corrupts the first header.
  if (input.charCodeAt(0) === 0xfeff) i = 1;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Ignore the trailing blank line most exports end with.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i]!;

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      if (input[i + 1] === '\n') i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (char === '\n') {
      pushRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

export interface CsvTable {
  headers: string[];
  rows: Record<string, string>[];
}

export function toTable(input: string): CsvTable {
  const raw = parseCsv(input);
  const headers = raw[0];
  if (!headers) return { headers: [], rows: [] };

  const rows = raw.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? '';
    });
    return record;
  });

  return { headers, rows };
}
