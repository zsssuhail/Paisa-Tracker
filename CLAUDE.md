# Paisa

Local-first personal finance PWA (React + TS + Vite + Dexie). See README.md for architecture.

## UI work
Before building or changing any screen, load the project skills `taste` (`.claude/skills/taste/SKILL.md`) and `frontend-design` (`.claude/skills/frontend-design/SKILL.md`), then follow `DESIGN.md`. DESIGN.md is the design source of truth (section 8 records the frontend-design review); tokens are in `src/design/tokens.css`.

## Import work
Statement parsing is regression-tested against the layouts of real files in `src/features/import/statements.test.ts` (names and numbers invented). Never commit real statements: they contain names, phone numbers and account numbers.

## Conventions
- Money is integer paise everywhere; format only at display time (`src/data/money.ts`).
- Dates are ISO `YYYY-MM-DD` in IST; month periods respect the user's month-start day (`src/data/dates.ts`).
- UI talks to data only through `src/data/repo/*` so a backend can be added later.
- Node is installed via nvm: `export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"`.
