import Papa from 'papaparse';
import type { Category, Transaction } from '@/data/types';
import { exportSnapshot } from '@/data/repo';
import { todayISO } from '@/data/dates';

export function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Same columns as the original spreadsheet, so it re-imports cleanly. */
export function transactionsToCSV(txs: Transaction[], cats: Map<string, Category>): string {
  return Papa.unparse(
    txs.map((t) => ({
      Date: t.date,
      Type: t.type === 'expense' ? 'Expense' : t.type === 'income' ? 'Income' : 'Transfer',
      Category: t.categoryId ? cats.get(t.categoryId)?.name ?? '' : '',
      'Item / Description': t.item,
      Where: t.place,
      'Payment Mode': t.paymentMode,
      'Amount (₹)': (t.amountPaise / 100).toFixed(2),
      Notes: t.note,
    })),
  );
}

export function downloadCSV(txs: Transaction[], cats: Map<string, Category>, name = 'paisa-transactions') {
  download(new Blob(['﻿' + transactionsToCSV(txs, cats)], { type: 'text/csv;charset=utf-8' }), `${name}-${todayISO()}.csv`);
}

export async function downloadBackup() {
  const snap = await exportSnapshot();
  download(new Blob([JSON.stringify(snap)], { type: 'application/json' }), `paisa-backup-${todayISO()}.json`);
}

export async function downloadNodeAsImage(node: HTMLElement, fileName: string) {
  const { toPng } = await import('html-to-image');
  const bg = getComputedStyle(document.body).backgroundColor;
  const url = await toPng(node, { pixelRatio: 2, backgroundColor: bg, cacheBust: true });
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
}
