import Papa from 'papaparse';
import type { ImportFile } from './types';
import { extractPdfLines } from './pdf/extract';
import { detectColumns } from './table';

export class PasswordRequired extends Error {}
/** A file we recognised but can't read in the browser, with what to do instead. */
export class UnsupportedFile extends Error {}

type Kind = ImportFile['kind'] | 'numbers' | 'image' | 'unknown';

/**
 * What a file really is, from its first bytes — never from its name. Downloads arrive as
 * "statement (3).xls", "AccountStatement_06072026.csv.txt" or with no extension at all.
 */
export function sniff(bytes: Uint8Array, name: string, mime = ''): Kind {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 512));
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('PK')) {
    // Zip: Excel (.xlsx) or Apple Numbers. Numbers bundles carry "Index/" entries.
    const text = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 200_000)));
    if (/Index\/Document\.iwa|\.iwa/.test(text) && !/xl\/workbook/.test(text)) return 'numbers';
    return 'xlsx';
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return 'xlsx'; // legacy .xls
  if (/^\x89PNG|^\xFF\xD8\xFF|^GIF8|^RIFF.{4}WEBP|ftypheic/.test(head)) return 'image';
  const text = decodeText(bytes.slice(0, 4096)).trimStart();
  if (/^<(?:!doctype html|html|\?xml)/i.test(text)) {
    // Excel "HTML/XML spreadsheets" exported by many banks as .xls.
    return /<table|urn:schemas-microsoft-com:office:spreadsheet/i.test(text) && !/outer-cell/.test(text) ? 'xlsx' : 'html';
  }
  if (/^[[{]/.test(text)) return 'json';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'numbers' || /numbers/.test(mime)) return 'numbers';
  // Text with a steady delimiter on most lines is a table, whatever the extension says.
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  const delimited = lines.filter((l) => (l.match(/[,;\t|]/g) ?? []).length >= 2).length;
  if (lines.length >= 2 && delimited / lines.length >= 0.6) return 'csv';
  return 'text';
}

/** UTF-8 (with or without BOM) or UTF-16 as Excel sometimes saves "Unicode text". */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.slice(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.slice(2));
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  // Windows-1252 exports show up as replacement characters in UTF-8.
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

/** Read any supported file in the browser. Nothing is uploaded anywhere. */
export async function loadFile(file: File, password?: string): Promise<ImportFile> {
  const name = file.name;
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) throw new UnsupportedFile(`${name} is empty.`);
  const kind = sniff(bytes, name, file.type);

  if (kind === 'numbers') {
    try {
      return await fromWorkbook(name, buffer);
    } catch {
      throw new UnsupportedFile('This Apple Numbers file could not be read. In Numbers, choose File → Export To → Excel (or CSV), then import that file.');
    }
  }
  if (kind === 'image') throw new UnsupportedFile('This is a photo or screenshot. Import the PDF, CSV or Excel statement from your bank or app instead.');

  if (kind === 'pdf') {
    try {
      const lines = await extractPdfLines(buffer, password);
      if (!lines.length) throw new UnsupportedFile('This PDF has no text in it (it is probably a scan). Download the statement again as a PDF from net banking, or as CSV / Excel.');
      return { name, kind: 'pdf', lines, text: lines.map((l) => l.text).join('\n') };
    } catch (e) {
      if ((e as { name?: string }).name === 'PasswordException') throw new PasswordRequired('This PDF is password protected.');
      throw e;
    }
  }
  if (kind === 'xlsx') return fromWorkbook(name, buffer);
  const text = decodeText(bytes);
  if (kind === 'csv') return fromCsv(name, text);
  if (kind === 'html') return { name, kind: 'html', text };
  if (kind === 'json') return { name, kind: 'json', text };
  return { name, kind: 'text', text };
}

/** How much a sheet looks like a list of payments: a dated header and many dated rows. */
function scoreSheet(table: string[][]): number {
  const header = detectColumns(table);
  const hasHeader = header || table.slice(0, 10).some((r) => /date/i.test(r.join(' ')) && /amount|debit|credit|₹/i.test(r.join(' ')));
  if (!hasHeader) return 0;
  const dated = table.filter((r) => r.some((c) => /\d{1,2}[-/ ][A-Za-z0-9]{2,9}[-/ ]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(c))).length;
  // A full payments table (description and amount columns) beats a side list like "Money In".
  return (header ? 1_000 : 10) + dated;
}

export async function fromWorkbook(name: string, buffer: ArrayBuffer): Promise<ImportFile> {
  const XLSX = await import('xlsx');
  // Real date cells come out as ISO, so no day/month guessing for them.
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' });
  const sheets = wb.SheetNames.map((sheetName) => ({
    name: sheetName,
    table: XLSX.utils
      .sheet_to_json<string[]>(wb.Sheets[sheetName], { header: 1, raw: false, defval: '', blankrows: false, dateNF: 'yyyy-mm-dd' })
      .map((r) => r.map((c) => String(c ?? '').trim()))
      // Spreadsheet templates carry hundreds of empty formatted rows.
      .filter((r) => r.some(Boolean)),
  }));
  // The sheet that looks most like payments wins, not simply the first ("Export Summary" in Numbers exports).
  const best = [...sheets].sort((a, b) => scoreSheet(b.table) - scoreSheet(a.table))[0] ?? { name: '', table: [] };
  return {
    name,
    kind: 'xlsx',
    table: best.table,
    sheets,
    text: [best.name, ...best.table.slice(0, 30).map((r) => r.join(' '))].join('\n'),
  };
}

export function fromCsv(name: string, text: string): ImportFile {
  const clean = text.replace(/^﻿/, '');
  const parsed = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy' });
  const table = parsed.data.map((r) => r.map((c) => String(c ?? '').trim()));
  return { name, kind: 'csv', table, text: table.slice(0, 30).map((r) => r.join(' ')).join('\n') };
}

export function fromPaste(text: string): ImportFile {
  // A pasted CSV (commas/tabs on most lines) is treated as a table.
  const lines = text.trim().split('\n');
  const tabular = lines.length > 1 && lines.filter((l) => l.split(/[\t,]/).length >= 3).length / lines.length > 0.8;
  if (tabular) return fromCsv('Pasted table', text);
  return { name: 'Pasted text', kind: 'text', text };
}
