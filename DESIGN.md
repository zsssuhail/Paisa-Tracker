# Design System: Paisa

Generated with the project `taste` skill (`.claude/skills/taste/SKILL.md`). This file is the single source of truth for every screen. Tokens live in `src/design/tokens.css`; when they change, change both.

## 1. Visual Theme & Atmosphere
A calm, quietly confident money notebook. The interface feels like a well-kept pocket ledger that learned modern banking manners: generous margins, one decisive green, numbers that sit large and still. Nothing shouts. Over-budget is reported the way a good friend would say it — plainly, without alarm.

- **Density 5 — "Daily App Balanced".** Enough on screen to answer a question at a glance, never a cockpit.
- **Variance 6 — "Offset Asymmetric".** The Home dashboard leads with one oversized figure on the left with supporting figures stacked in an offset column; grids use 7/5 and 8/4 splits on desktop, never three equal cards. Money UIs must stay predictable, so asymmetry lives in composition, not in navigation.
- **Motion 5 — "Fluid CSS + springs".** Motion confirms actions (save, delete, approve) and reveals lists. It never decorates idle screens.

## 2. Color Palette & Roles
One neutral family (Zinc) for both themes. One accent. Semantic colours are always paired with an icon and a word.

### Light
- **Paper Canvas** (#FAFAFA) — app background
- **Pure Sheet** (#FFFFFF) — cards, sheets, inputs
- **Soft Shelf** (#F4F4F5) — chips, segmented controls, table stripes
- **Charcoal Ink** (#18181B) — primary text and large figures
- **Graphite** (#52525B) — secondary text, labels
- **Muted Steel** (#71717A) — metadata, timestamps, axis labels (AA on Sheet)
- **Whisper Line** (#E4E4E7) — 1px dividers and borders
- **Ledger Green** (#0F766E) — the single accent: primary buttons, active nav, focus rings, "on track" state, the budget pace line
- **Ledger Mist** (#E7F3F1) — accent tint for selected chips and progress tracks
- **Turmeric** (#B45309) — "close to the limit" (80%+). Always with a gauge icon and the word "Close"
- **Terracotta** (#B4483A) — "over". Always with an arrow-up icon and the word "Over". Never a red flood; only text, bar fill and a small tag

### Dark
- **Night Canvas** (#0F0F11) — never #000000
- **Night Sheet** (#18181B)
- **Night Shelf** (#232327)
- **Bone Ink** (#F4F4F5)
- **Ash** (#A1A1AA)
- **Smoke** (#8B8B94)
- **Night Line** (#2E2E33)
- **Ledger Green (night)** (#4FB3A5), text on it is Night Canvas
- **Ledger Mist (night)** (#16302D)
- **Turmeric (night)** (#E0A458)
- **Terracotta (night)** (#E58A7C)

### Chart series
Categorical series use a muted, validated 8-step palette defined in `src/design/chartPalette.ts`. Series are ordered by value, and anything past the 7th rolls into "Other" (Smoke). Charts never use the semantic colours for categories.

**Banned:** purple/blue neon, gradient text, glows, oversaturated accents (accent saturation stays under 80%), warm/cool gray mixing, pure black.

## 3. Typography Rules
- **Display & UI:** `Geist` — headline weights 600, tracking -0.02em, scale controlled by `clamp()`. Hierarchy comes from weight and ink colour, not size alone.
- **Figures:** Geist (the same family as the text) with tabular digits (`.num`) in lists, tables and chart axes, so columns of rupees align. No monospace for data. The single hero figure on Home is Geist 600 with proportional digits at `clamp(4.25rem, 15vw, 6.5rem)`, written across the notebook rules; exactly one per view.
- **Monospace:** only for raw bank text shown for reference (the original narration in the import review).
- **Body:** Geist 15–16px, line-height 1.55, max 65ch.
- **Indian grouping by default:** ₹1,25,000. Paise shown only when non-zero (₹560.20).
- **Banned:** Inter, all serif fonts (this is a software UI), all-caps labels of any size. Small labels are sentence case (`.label-quiet`, 13px, medium, Muted Steel).

### The one bold element: today's notebook page (Home)
The thing being replaced is a handwritten ledger, so Home opens on today's page of an Indian school notebook: **Rule Blue** lines 32px apart (light rgb 205 220 238, dark rgb 38 50 66), a **Margin Red** line (rgb 214 92 92 at 55%) with the date written in the margin, and the safe-to-spend figure written across two rules with a small raised ₹. Every other surface stays quiet. Do not reuse the ruled-page treatment elsewhere.

## 4. Component Stylings
- **Buttons:** Flat. Primary is Ledger Green fill with white text, 14px radius, 48px tall on mobile. Secondary is Shelf fill with Ink text. Ghost is text-only. Active state presses 1px down and scales to 0.98. No glows, no custom cursors.
- **Floating add button:** a 60px Ledger Green rounded square (20px radius), bottom-right, above the bottom nav and inside the thumb zone. It's the only floating element.
- **Cards:** 24px radius, Sheet fill, 1px Whisper Line, and a soft shadow tinted with zinc (`0 1px 2px rgb(24 24 27 / .04), 0 8px 24px -12px rgb(24 24 27 / .08)`). Use cards only for groups that need elevation. Lists use dividers.
- **Bottom sheet:** slides up with a spring, has a 28px top radius and a grab handle, and closes on Esc or a downward drag. On desktop it becomes a centred 480px dialog.
- **Chips:** pill shaped, 36px tall, Shelf fill. Selected chips get Ledger Mist fill with an accent border and accent text. Every chip shows its category icon at 16px.
- **Inputs:** label above, helper or error text below, 48px tall, 12px radius, accent focus ring of 2px at 2px offset. No floating labels. The amount input is Geist with tabular digits at 40px with a ₹ prefix.
- **Progress bars:** 8px tall and fully rounded, with a Mist track. The fill uses the state colour, and the state word and icon sit beside the bar.
- **Loaders:** skeleton blocks the same size as the content, with a slow shimmer. No spinners.
- **Empty states:** a small composed line illustration (inline SVG), one sentence that teaches, and one action. Example: "No payments yet. Tap + to add your first one, it takes 5 seconds."
- **Toasts:** bottom, above the nav, Ink fill, with "Undo" as a text action. They auto-dismiss after 5s.
- **Icons:** Lucide at 1.75 stroke. **No emojis anywhere.**

## 5. Layout Principles
- Mobile first, max content width 1200px on desktop.
- **Mobile (<768px):** single column, 16px gutters, bottom nav (Home, Transactions, Budget, Goals, Insights) and the FAB.
- **Desktop (≥1024px):** left rail nav (240px) replaces the bottom nav. Content uses a 12-column grid with asymmetric 7/5 or 8/4 splits.
- **Home composition:** a left-aligned hero ("Safe to spend today" figure with "Left this month" beneath it). On desktop an offset column beside it holds the pace status and the comparison with last month. Below that: the insight card at full width, top categories as a ranked list (not cards), then upcoming items.
- Use CSS Grid for layout, with no `calc()` percentage hacks. Use `min-h-[100dvh]`, never `h-screen`.
- No overlapping elements. No horizontal page scroll. Chip rows may scroll sideways inside their own container.
- Touch targets are at least 44px.

## 6. Motion & Interaction
- Springs by default: `stiffness: 100, damping: 20` for layout, and `stiffness: 400, damping: 30` for presses and the sheet.
- **Count-up:** headline totals count up over 600ms when the value changes.
- **Save bounce:** on save, the FAB scales 1 → 0.92 → 1, the new row slides in from 8px with a fade, and the device vibrates for 10ms where supported.
- **Staggered lists:** rows fade and rise in with a 30ms stagger, first paint only, capped at the first 12 rows.
- Only `transform` and `opacity` are animated.
- Perpetual loops are restricted on purpose, because a finance app at rest should be still. The only ones are the skeleton shimmer and a gentle pulse on the "Needs a category" badge while the count is above zero.
- `prefers-reduced-motion: reduce` turns all of this off: values appear instantly and nothing moves.

## 7. Anti-Patterns (Banned)
- Emojis
- Inter, or any serif font
- Pure black (#000000)
- Neon, outer glows, purple or blue gradients, gradient text
- Rows of 3 equal cards
- Centred hero blocks
- AI copywriting: "Elevate", "Seamless", "Unleash", "Next-Gen", "Supercharge"
- Jargon: use "Left to spend", not "variance"; "Money in / Money out", not "inflows / outflows"
- Generic placeholder names. Sample data uses the real Indian context from the spec
- Filler UI text like "Scroll to explore", scroll arrows or bouncing chevrons
- Colour as the only signal of state
- Alarmist red full-screen states for being over budget
- Spinners


## 8. Revision notes (frontend-design skill pass)
Reviewed against the `frontend-design` skill's list of generated-design defaults and changed:
- Hero: the default "big number, small label, progress bar" became the notebook page above, taken from the subject itself.
- Monospace figures and chart ticks → Geist with tabular digits.
- All-caps eyebrow labels → sentence-case labels.
- Meta strings joined with middle dots → commas; tab counts in brackets.
- Links ending in "→" → plain verb links ("See all charts").
- Identical rounded chart cards with shadows → chart sections under a hairline rule; cards remain only where they group actions.
- Staggered fade-and-slide on every Home section → one moment of motion, the figure counting up.
