import type { PdfCell, PdfLine } from '../types';

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

/**
 * Pull positioned text out of a text-based PDF entirely in the browser.
 * Items on the same baseline become one line; touching items merge into one cell.
 */
export async function extractPdfLines(data: ArrayBuffer, password?: string): Promise<PdfLine[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data, password, isEvalSupported: false }).promise;
  const lines: PdfLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as TextItem[]).filter((i) => typeof i.str === 'string' && i.str.trim());
    lines.push(...groupLines(items.map((i) => ({ x: i.transform[4], y: i.transform[5], width: i.width, text: i.str })), p));
  }
  await doc.destroy();
  return lines;
}

/**
 * Some exporters (Apple Numbers, some Excel PDFs) write the ligatures "ti", "ft", "tt" as glyphs
 * pdf.js decodes as "7", "G", "c". They arrive as their own tiny item butting into the letters on
 * both sides ("Sta" "7" "onery"), which normal text never does, so the repair is safe.
 */
const BROKEN_LIGATURES: Record<string, string> = { '7': 'ti', G: 'ft', c: 'tt', '6': 'fi', '5': 'fl' };

type Item = { x: number; y: number; width: number; text: string };

function repairLigatures(items: Item[]): Item[] {
  const out = items.map((i) => ({ ...i }));
  for (let i = 0; i < out.length; i++) {
    const it = out[i];
    const fix = BROKEN_LIGATURES[it.text];
    if (!fix) continue;
    const prev = out[i - 1];
    const next = out[i + 1];
    const touchesPrev = prev && Math.abs(it.x - (prev.x + prev.width)) <= 0.4;
    const touchesNext = next && Math.abs(next.x - (it.x + it.width)) <= 0.4;
    const afterWord = touchesPrev && /[\p{L} ]$/u.test(prev.text);
    const beforeWord = touchesNext && /^\p{Ll}/u.test(next.text);
    if (beforeWord && (afterWord || !prev || !touchesPrev)) it.text = fix;
    else if (afterWord && !next && /\p{Ll}$/u.test(prev.text)) it.text = fix;
  }
  return out;
}

export function groupLines(items: Item[], page: number, tolerance = 2.5): PdfLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; items: Item[] }[] = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tolerance);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows.map((r) => {
    const cells: PdfCell[] = [];
    for (const it of repairLigatures(r.items.sort((a, b) => a.x - b.x))) {
      const prev = cells[cells.length - 1];
      // Merge runs that touch (pdf.js often splits words); keep real column gaps.
      if (prev && it.x - (prev.x + prev.width) < 3) {
        const gap = it.x - (prev.x + prev.width) > 0.8 && !prev.text.endsWith(' ') ? ' ' : '';
        prev.text += gap + it.text;
        prev.width = it.x + it.width - prev.x;
      } else cells.push({ x: it.x, width: it.width, text: it.text });
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, ' ').trim();
    return { page, y: r.y, cells, text: cells.map((c) => c.text).join(' ') };
  });
}
