import { parseMoney } from '@/data/money';
import type { PdfCell, PdfLine } from '../types';
import { detectColumns } from '../table';
import { parseLooseDate } from '../dates';
import { joinWrapped } from '../upi';

interface Column {
  left: number;
  right: number;
  label: string;
}

const span = (c: PdfCell) => ({ left: c.x, right: c.x + c.width });

function distance(cell: PdfCell, col: Column) {
  const { left, right } = span(cell);
  // Inside the heading's span is a perfect fit; otherwise the nearest of left / right / centre alignment.
  if (left >= col.left - 1 && right <= col.right + 1) return 0;
  return Math.min(Math.abs(left - col.left), Math.abs(right - col.right), Math.abs((left + right) / 2 - (col.left + col.right) / 2));
}

function nearest(cell: PdfCell, cols: Column[]) {
  let best = 0;
  for (let i = 1; i < cols.length; i++) if (distance(cell, cols[i]) < distance(cell, cols[best])) best = i;
  return best;
}

/**
 * Headings are often printed over two or three lines ("Date(Value" / "Date)", "Ref No." / "/Cheque No").
 * Cells whose horizontal spans overlap belong to one column; their words join in reading order.
 */
function mergeHeader(lines: PdfLine[]): Column[] {
  const cells = lines.flatMap((l) => l.cells.map((c) => ({ ...span(c), text: c.text, y: l.y })));
  const cols: (Column & { parts: { y: number; text: string }[] })[] = [];
  for (const c of cells.sort((a, b) => a.left - b.left)) {
    const hit = cols.find((col) => c.left < col.right + 2 && c.right > col.left - 2);
    if (hit) {
      hit.left = Math.min(hit.left, c.left);
      hit.right = Math.max(hit.right, c.right);
      hit.parts.push({ y: c.y, text: c.text });
    } else cols.push({ left: c.left, right: c.right, label: '', parts: [{ y: c.y, text: c.text }] });
  }
  return cols
    .sort((a, b) => a.left - b.left)
    .map(({ parts, ...col }) => ({
      ...col,
      label: parts
        .sort((a, b) => b.y - a.y)
        .map((p) => p.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }));
}

/** The header block: one to three neighbouring lines whose words together name the statement columns. */
function findHeader(lines: PdfLine[]): { start: number; end: number; cols: Column[] } | null {
  for (let i = 0; i < lines.length; i++) {
    for (let n = 1; n <= 3 && i + n <= lines.length; n++) {
      const block = lines.slice(i, i + n);
      if (block.some((l) => l.page !== block[0].page)) break;
      if (n > 1 && Math.abs(block[0].y - block[n - 1].y) > 18) break;
      const cols = mergeHeader(block);
      if (cols.length < 3) continue;
      const found = detectColumns([cols.map((c) => c.label)], 1);
      if (found && (found.mapping.balance != null || found.mapping.debit != null || found.mapping.amount != null)) {
        // Prefer the widest block: a two-line heading read as one line misses words.
        let best = { start: i, end: i + n, cols };
        for (let m = n + 1; m <= 3 && i + m <= lines.length; m++) {
          const more = lines.slice(i, i + m);
          if (more.some((l) => l.page !== block[0].page) || Math.abs(more[0].y - more[m - 1].y) > 18) break;
          const c2 = mergeHeader(more);
          if (detectColumns([c2.map((c) => c.label)], 1)) best = { start: i, end: i + m, cols: c2 };
        }
        return best;
      }
    }
  }
  return null;
}

const isMoney = (s: string) => /^-?[₹]?\s?\d[\d,]*(\.\d{1,2})?\s*(cr|dr)?$/i.test(s.trim()) && parseMoney(s) != null;
const FOOTER = /^(page \d+|\d+ of \d+|\*\*|this is a computer generated|effective available balance|total|closing balance|opening balance|grand total|statement summary)/i;

/**
 * Bank statement PDFs → one row per transaction.
 *
 * Each transaction has exactly one "amount line" (the one carrying its balance, or its debit/credit).
 * Everything else that belongs to it — a date printed on the line above, a value date and the rest of the
 * narration on the line below — is gathered onto that anchor. Customer details above the heading, repeated
 * headings, page numbers and totals are left out.
 */
function statementTable(lines: PdfLine[]): string[][] | null {
  const header = findHeader(lines);
  if (!header) return null;
  const { cols } = header;
  const labels = cols.map((c) => c.label);
  const map = detectColumns([labels], 1)!.mapping;
  const moneyCols = new Set([map.balance, map.debit, map.credit, map.amount].filter((x): x is number => x != null));
  const anchorCols = map.balance != null ? new Set([map.balance]) : moneyCols;
  const headerText = new Set(lines.slice(header.start, header.end).map((l) => l.text));

  const body = lines.slice(header.end).filter((l) => !headerText.has(l.text) && !FOOTER.test(l.text.trim()) && !detectColumns([mergeHeader([l]).map((c) => c.label)], 1));
  const placed = body.map((l) => ({ line: l, cells: l.cells.map((c) => ({ col: nearest(c, cols), text: c.text })) }));
  const isAnchor = (p: (typeof placed)[number]) => p.cells.some((c) => anchorCols.has(c.col) && isMoney(c.text));
  const anchors = placed.filter(isAnchor);
  if (anchors.length < 2) return null;

  const hasDate = (p: (typeof placed)[number]) => p.cells.some((c) => c.col === map.date && parseLooseDate(c.text));
  // Single-line rows (date on the amount line) vs split rows (date on its own line, like IOB).
  const singleLine = anchors.filter(hasDate).length >= anchors.length * 0.6;
  const pitches = anchors.slice(1).map((a, i) => (a.line.page === anchors[i].line.page ? Math.abs(anchors[i].line.y - a.line.y) : 0)).filter((d) => d > 0).sort((a, b) => a - b);
  const pitch = pitches[Math.floor(pitches.length / 2)] ?? 14;

  const groups = new Map<(typeof placed)[number], (typeof placed)[number][]>(anchors.map((a) => [a, [a]]));
  for (const p of placed) {
    if (groups.has(p)) continue;
    const samePage = anchors.filter((a) => a.line.page === p.line.page);
    if (!samePage.length) continue;
    let owner: (typeof placed)[number] | undefined;
    if (singleLine) {
      // Wrapped narration continues below its row.
      const above = samePage.filter((a) => a.line.y > p.line.y).sort((a, b) => a.line.y - b.line.y)[0];
      if (above && above.line.y - p.line.y <= pitch * 1.6) owner = above;
    } else {
      const byDistance = [...samePage].sort((a, b) => Math.abs(a.line.y - p.line.y) - Math.abs(b.line.y - p.line.y));
      if (Math.abs(byDistance[0].line.y - p.line.y) <= Math.max(6, pitch * 0.7)) owner = byDistance[0];
    }
    if (!owner) continue;
    // Continuation lines only add words, never stray amounts.
    const cells = p.cells.filter((c) => !moneyCols.has(c.col) || !isMoney(c.text));
    if (cells.length) groups.get(owner)!.push({ ...p, cells });
  }

  const rows = anchors.map((a) => {
    const parts = groups.get(a)!.sort((x, y) => (x.line.page - y.line.page) || y.line.y - x.line.y);
    const row = cols.map(() => '');
    for (const part of parts) for (const c of part.cells) row[c.col] = c.col === map.description ? joinWrapped(row[c.col], c.text) : row[c.col] ? `${row[c.col]} ${c.text}` : c.text;
    return row;
  });
  return [labels, ...rows];
}

/**
 * Spreadsheet apps (Apple Numbers, Excel) print a wide table as vertical strips: a few columns per
 * run of pages. Rows sit at the same position on the matching page of every strip, so the strips
 * are stitched back side by side.
 */
function tiledTable(lines: PdfLine[]): string[][] | null {
  const pages = new Map<number, PdfLine[]>();
  for (const l of lines) pages.set(l.page, [...(pages.get(l.page) ?? []), l]);
  const content = (ls: PdfLine[]) => ls.filter((l) => !/^\d{1,4}$/.test(l.text.trim()));

  type Strip = { header: PdfLine; pages: PdfLine[][] };
  const strips: Strip[] = [];
  let current: Strip | null = null;
  for (const n of [...pages.keys()].sort((a, b) => a - b)) {
    const ls = content(pages.get(n)!).sort((a, b) => b.y - a.y);
    if (!ls.length) {
      current = null;
      continue;
    }
    const top = ls[0];
    const looksLikeHeader = !/\d/.test(top.text) && ls.length > 1;
    if (looksLikeHeader && (!current || current.pages.length > 0)) {
      current = { header: top, pages: [ls.slice(1)] };
      strips.push(current);
    } else if (current) current.pages.push(ls);
  }
  if (strips.length < 2) return strips.length === 1 ? stripRows(strips[0]) : null;

  // Keep strips that line up with the first one (same page count, rows at the same heights).
  const key = (pageIdx: number, y: number) => `${pageIdx}:${Math.round(y / 3)}`;
  const firstKeys = new Set(strips[0].pages.flatMap((ls, i) => ls.map((l) => key(i, l.y))));
  const aligned = strips.filter((s) => {
    const keys = s.pages.flatMap((ls, i) => ls.map((l) => key(i, l.y)));
    return keys.length > 0 && keys.filter((k) => firstKeys.has(k)).length / keys.length > 0.8;
  });
  const parts = aligned.map(stripColumns);
  const header = parts.flatMap((p) => p.cols.map((c) => c.label));
  const rowKeys = [...firstKeys];
  const rows = rowKeys.map((k) => parts.flatMap((p) => p.rows.get(k) ?? p.cols.map(() => '')));
  return [header, ...rows];

  function stripColumns(s: Strip) {
    const cols = mergeHeader([{ ...s.header, cells: joinNearby(s.header.cells) }]);
    const rows = new Map<string, string[]>();
    s.pages.forEach((ls, i) =>
      ls.forEach((l) => {
        const row = cols.map(() => '');
        for (const c of l.cells) {
          const col = nearest(c, cols);
          row[col] = row[col] ? `${row[col]} ${c.text}` : c.text;
        }
        rows.set(key(i, l.y), row);
      }),
    );
    return { cols, rows };
  }
  function stripRows(s: Strip) {
    const { cols, rows } = stripColumns(s);
    return [cols.map((c) => c.label), ...rows.values()];
  }
}

/** "Amount (" "₹" ")" printed as separate runs are one heading. */
function joinNearby(cells: PdfCell[]): PdfCell[] {
  const out: PdfCell[] = [];
  for (const c of [...cells].sort((a, b) => a.x - b.x)) {
    const prev = out[out.length - 1];
    if (prev && c.x - (prev.x + prev.width) < 10 && (/[(₹]$/.test(prev.text) || /^[)₹]/.test(c.text))) {
      prev.text = `${prev.text}${c.text}`.replace(/\(\s*₹\s*\)/, '(₹)');
      prev.width = c.x + c.width - prev.x;
    } else out.push({ ...c });
  }
  return out;
}

/** Rebuild a table from positioned PDF text: bank statement layout first, then tiled spreadsheet exports. */
export function pdfLinesToTable(lines: PdfLine[]): string[][] | null {
  return statementTable(lines) ?? tiledTable(lines);
}

/** For unknown PDFs: split each line into cells on large gaps so the column mapper can work. */
export function pdfLinesToLooseTable(lines: PdfLine[]): string[][] {
  return lines.map((l) => l.cells.map((c) => c.text));
}
