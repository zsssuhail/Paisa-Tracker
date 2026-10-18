# Paisa — money notebook

A local-first personal finance PWA for UPI-heavy daily spending. You can add a payment in under 5 seconds, import Google Pay and bank statements without double counting, and set budgets and goals. Every chart says what it means in one sentence. All data stays in the browser (IndexedDB). There is no account and no server.

## Run it

```bash
# Node 22 via nvm (already installed on this machine)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"

npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (Vitest): parsers, dedupe, budget/goal/split maths
npm run e2e          # end-to-end (Playwright, mobile viewport): add, import, budget
npm run build        # production build + service worker (installable, works offline)
npm run preview      # serve the build on http://localhost:4173
```

On first open, pick **Look around with sample data** to load the sample month from the brief plus three months of history. Clear it in one tap from the banner or from Settings.

## Design

`DESIGN.md` is the design source of truth. It was generated with the project's `taste` skill (`.claude/skills/taste/SKILL.md`) and revised with the `frontend-design` skill (`.claude/skills/frontend-design/SKILL.md`); its tokens live in `src/design/tokens.css`.

- **Look and type:** Zinc neutrals with one accent, Ledger Green. One family, Geist, with tabular figures in lists. Home opens on today's page of a ruled school notebook; everything else stays quiet (see DESIGN.md §8 for the `frontend-design` review).
- **Layout:** asymmetric 7/5 layouts on desktop, with a bottom nav and a + button on mobile.
- **Status:** semantic colours always come with an icon and a word.
- **Chart colours:** categorical series use a palette that passes the dataviz validator in both themes. Each chart gives every visible series its own colour.
- **Motion:** springs and count-ups throughout, all turned off under reduced-motion.

## Architecture

```
src/
  app/          shell: router, layout (rail / bottom nav / FAB), toasts, theme
  design/       tokens.css, primitives (Sheet, Chip, ProgressBar, Ring, Amount…), icons, chart palette
  data/
    types.ts    data model (all money in integer paise, dates as ISO in IST)
    db.ts       Dexie schema
    repo/       repository layer — the only code that touches storage
    store.ts    live mirror of the DB (Zustand), fed by repo.observe()
    money.ts    parsing/formatting (₹1,25,000), no floating point
    dates.ts    IST dates, custom month-start periods
  features/
    transactions/  quick-add sheet, virtualised list, filters, bulk edit, undo
    categories/    defaults, CRUD, groups, merge
    rules/         "learn from me": payee → category rules + rules of thumb
    budget/        simple + zero-based maths, rollover, safe-to-spend, nudges, templates
    goals/         goals, savings buckets, auto-saving, round-ups, pay-yourself-first, debts
    friends/       splits (only my share counts), balances, payback matching
    recurring/     auto-add / remind
    import/        parsers, PDF row rebuild, pipeline (classify → categorise → dedupe/merge → reconcile → commit), review UI
    insights/      aggregates, insight engine, 16 charts, common expenses, monthly report
    settings/      backup/restore, CSV export, PIN lock
    onboarding/    5-step first run, sample data
```

### Storage and sync

- The UI reads from `useData` (a live mirror) and writes through `repo.*`. Adding cloud sync later (Supabase or Firebase) means re-implementing `src/data/repo/index.ts` against the backend while keeping `observe()` live. Screens don't change.
- Backups are one JSON file (`exportSnapshot` / `importSnapshot`). Bill photos are device-only.

### Import

Every source is a `Parser` with `detect(file) → 0..1` and `parse(file) → RawTransaction[]`, registered in `features/import/parsers/index.ts`. To add a bank, add a parser to that list.

- **Built in:** Google Pay (Takeout HTML/JSON, transactions CSV, statement PDF), Indian Overseas Bank, a generic bank reader for column-labelled statements (SBI, HDFC, ICICI, Axis, Canara, Kotak), PhonePe PDF, Paytm passbook, the old spreadsheet CSV, and pasted text or SMS alerts.
- **Unknown layouts** open the column mapper. The mapping is saved as a custom source that is recognised by its header row next time.
- **PDFs** are read with pdf.js entirely in the browser. Rows are rebuilt from text positions (`pdf/toTable.ts`), and wrapped narration lines are joined back onto their row.
- **Same file twice:** each row gets a stable `importRef`, so re-importing a file adds nothing.
- **Across sources:** a Google Pay row and a bank row become one transaction when the UPI reference matches, or when the amount matches, the date is within ±1 day and the payee is similar. The existing transaction keeps both source tags, and two identical payments from the same source are never merged.
- **Reconciliation:** statements with a running balance are checked (opening + in − out = closing), and any jump between rows is reported as a possibly missing row.
- **Batches:** every import is saved as a batch and can be undone in one tap.

### What a statement line really says

Most of a bank statement is not payment data. For an IOB line like

```
17-Oct-26   UPI/629038165565/DR/ANNATCHI     S74301559  Transfer  120.00  -  8,993.91
(17-Oct-26) FAMOU/YES/UPI
```

the app keeps the date, the payee (`Annatchi Famou`, completed from your notebook or a brand list when the bank cut it short), the amount and direction, the UPI reference (for duplicate detection), the running balance (for the reconciliation check), and a note only when a person wrote one (`dinner`). It sets aside the value date, the bank reference and "Transfer" type columns, bank codes (`YES`, `CNR`, `HDF`), app tags (`UPIIntent`, `collect-pay`, `StaticQR`, `LiteEnable`, `Payment f…`), customer and branch details, page numbers and totals. The review screen lists exactly what was kept and set aside for each file.

How the readers cope with real files:
- **PDF statements** whose rows span three printed lines (date line, amount line, value-date line) and whose headings span three lines are rebuilt around each row's amount line (`pdf/toTable.ts`).
- **Spreadsheets exported to PDF** (Apple Numbers prints wide tables as strips of pages and some letter pairs as stray glyphs: "Sta7onery") are stitched back together and repaired.
- **Workbooks**: the sheet that looks like payments is used (not simply the first, e.g. Numbers' "Export Summary"), and a "Money In" sheet is read too. `.numbers` files are read directly.
- **File names don't matter**: the type is recognised from the file's content; dates are read day-first or month-first from the whole column.
- **Your notebook wins**: when a spreadsheet row and a bank row are the same payment, the spreadsheet's share, category and note are kept and the bank adds its reference. A spreadsheet note that mentions the full bill ("Paid ₹1,100 for the table") links your share to the bank's ₹1,100 debit, so shared bills are not counted twice.
- **Overlapping statements** dedupe on the UPI or bank reference, including payments already merged into notebook entries.

### Performance

The transaction list is virtualised and aggregates are memoised. Measured with 5,012 transactions on a phone viewport at 4× CPU throttle:

| Screen | Load time |
|---|---|
| Home | ~420 ms |
| Transactions | ~290 ms |
| Budget | ~310 ms |
| Insights (first load of the chart library) | ~1.5 s |

## Help me harden the Google Pay parser

The Google Pay parser is built from the documented export formats and tested against hand-written fixtures. To make it robust against real-world variations, please share, with personal details blanked out:

1. Google Takeout → Google Pay → `My Activity/Google Pay/My Activity.html` (a few weeks is enough).
2. The statement PDF from the Google Pay app (Profile → Bank account → View statement), if your app offers it.
3. One month of your IOB statement as PDF, to check row reconstruction on the real layout.
