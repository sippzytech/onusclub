// CSV parsing and generation for customer import/export.
//
// Hand-rolled rather than pulling in papaparse: the format is small, the
// edge cases that actually matter to us are specific, and this keeps the
// dependency surface where it is. Same reasoning as the SVG renderer in
// packages/shared.
//
// The edge cases that matter, in order of how often they will bite:
//
//  1. Dutch Excel writes SEMICOLON-delimited CSV. The list separator follows
//     the OS locale, and in NL (and DE, FR, ES…) that is ';', not ','. A
//     Netherlands-first product whose importer only accepts commas would fail
//     on most real café exports. So the delimiter is sniffed, not assumed.
//  2. Excel prefixes a UTF-8 BOM. Unstripped, the first header reads
//     "﻿name" and never matches, so every column silently maps to nothing.
//  3. Windows line endings, and a trailing newline on the last row.
//  4. Quoted fields containing the delimiter, and doubled quotes inside them —
//     "De Vries, Jan" and "O""Brien".

export type CsvRow = Record<string, string>;

const DELIMITERS = [",", ";", "\t"] as const;

/**
 * Pick the delimiter by counting candidates in the header line, outside
 * quotes. The header is the safest line to judge: it is the one row
 * guaranteed to have a value in every column.
 */
function sniffDelimiter(headerLine: string): string {
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < headerLine.length; i += 1) {
      const ch = headerLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Split one line on the delimiter, honouring quotes and doubled quotes. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1; // doubled quote is a literal quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/**
 * Split into lines, keeping newlines that sit inside quoted fields — a name or
 * note field can legitimately contain one.
 */
function splitLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.filter((l) => l.trim().length > 0);
}

/** Lowercased, stripped of spaces/underscores, so "First Name" ≈ "first_name". */
function normaliseHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export interface ParsedCsv {
  rows: CsvRow[];
  headers: string[];
  delimiter: string;
}

export function parseCsv(input: string): ParsedCsv {
  // Strip the BOM before anything else looks at the text.
  const text = input.replace(/^﻿/, "");
  const lines = splitLines(text);
  if (lines.length === 0) return { rows: [], headers: [], delimiter: "," };

  const delimiter = sniffDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter).map(normaliseHeader);

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = splitLine(lines[i], delimiter);
    const row: CsvRow = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = values[idx] ?? "";
    });
    rows.push(row);
  }
  return { rows, headers, delimiter };
}

/**
 * Accepted header spellings, so a café's existing spreadsheet usually imports
 * without being reformatted first. Keys are the normalised forms.
 */
const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "fullname", "customername", "firstname", "naam", "klant"],
  email: ["email", "emailaddress", "mail", "e-mail", "emailadres"],
  phone: ["phone", "phonenumber", "mobile", "tel", "telephone", "telefoon", "telefoonnummer"],
  birthday: ["birthday", "birthdate", "dob", "dateofbirth", "geboortedatum"],
};

export function pickField(row: CsvRow, field: keyof typeof FIELD_ALIASES): string {
  for (const alias of FIELD_ALIASES[field]) {
    const v = row[alias];
    if (v !== undefined && v.trim() !== "") return v.trim();
  }
  return "";
}

/**
 * Normalise a date to YYYY-MM-DD, accepting the formats a European
 * spreadsheet actually produces. Returns null when it cannot be read
 * confidently — a wrong birthday means the birthday sweep messages someone on
 * the wrong day, which is worse than having none.
 *
 * DD-MM-YYYY is read day-first, matching NL convention. Ambiguous values like
 * 03/04/1990 are therefore 3 April, not 4 March.
 */
export function normaliseDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const euro = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(v);
  if (euro) {
    const day = Number(euro[1]);
    const month = Number(euro[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return `${euro[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

/** RFC-4180 quoting: wrap when needed, double any embedded quotes. */
function csvEscape(value: string | null): string {
  const v = value ?? "";
  if (/[",;\t\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/**
 * Build a CSV document. Leads with a UTF-8 BOM so Excel reads accented names
 * correctly — without it "Sanne de Grève" arrives mangled.
 */
export function toCsv(headers: string[], rows: Array<Array<string | null>>): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
