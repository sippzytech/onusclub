# Card Design System — Spec

Written 2026-08-24. Defines the two ways a merchant gets a designed loyalty card:
**Design your own** (blank editor) and **Start from a template** (preset seeds the
same editor). Reference screenshots in [`refs/`](./refs/).

Companion to [PERKSTAR_ANALYSIS.md](../../PERKSTAR_ANALYSIS.md), which covers the rest of
the competitor tear-down. This file is only about card visuals.

---

## 1. What Perkstar actually does

### The builder is a 4-step wizard

`Card type → Settings → Design → Information`, with a **live iPhone preview pinned to the
right** the whole way through. The preview has a platform switcher (Apple / Android /
push-notification) as a vertical rail of three buttons beside the phone. Card title
(`Stamp card № 1`) is edited in the top bar, not inside a step.

See [`refs/perkstar-01-card-type-step.png`](./refs/perkstar-01-card-type-step.png).

### Both entry points live in one gallery

The top of the template gallery
([`refs/perkstar-05`](./refs/perkstar-05-gallery-top-from-scratch.png)) settles the UX
question. The **first tile in the grid is "Create card / From scratch"** — a plain
placeholder tile with a sparkle icon — and every template tile after it carries an
"Open" button. There is no separate "blank vs template" fork screen; the blank option is
simply tile #1. A single "All" filter chip sits top-right.

We should copy this exactly. It is the cleanest possible expression of the two options,
and it means "design your own" costs us one extra tile rather than a whole screen.

Their step 1 offers 8 card types, tagged with marketing labels — "High retention"
(Stamp, Reward, Membership, Discount, Cashback) and "Best for acquisition" (Coupon,
Multipass, Gift card). **This is a separate decision from card design** — CLAUDE.md
deliberately scopes us to stamp + points, and every template below works on those two.

### Template anatomy — the important part

From the gallery captures ([`refs/perkstar-02`](./refs/perkstar-02-template-gallery-a.png),
[`refs/perkstar-03`](./refs/perkstar-03-template-gallery-b.png)), every template is the
same layout with different token values:

```
┌──────────────────────────────┐
│ Food Truck                   │  ← title, small, on brand colour
├──────────────────────────────┤
│ ▓▓ ( ) ( ) ( ) ( ) ( ) ▓▓▓▓▓ │  ← STRIP: tiled pattern background
│ ▓▓ ( ) ( ) ( ) ( ) ( ) ▓▓▓▓▓ │    + circular stamp badges over it
├──────────────────────────────┤
│ STAMPS UNTIL THE REWA…       │  ← two field labels + values
│ No data        AVAILABLE…    │
│                              │
│         (solid brand fill)   │
│                              │
│   ▐║▌║▌║▐ barcode ▐║▌║▐      │  ← white rounded rect, 1D barcode
└──────────────────────────────┘
```

The tokens that vary per template:

| Token | Example values seen |
|---|---|
| Background colour | deep red (Food Truck), yellow (Gas station), magenta (Eyelash), black (Fitness), cream (Furniture) |
| Strip pattern | tiled illustration (hot dogs, gas pumps, flowers, eyes) or a photo |
| Stamp icon | glyph inside the badge — pump, gift, eye, paw, cupcake |
| Badge style | filled circle vs outlined circle; filled = earned, outlined = remaining |
| Foreground / label colour | white on dark, near-black on cream |
| Field labels | "STAMPS UNTIL THE REWARD", "AVAILABLE REWARDS" |

Two structural facts worth copying:

1. **Stamps render as a grid of icon badges, wrapping at 5 per row** (10 stamps = 2×5).
   This is the thing we currently render as the text `4/6`.
2. **The stamp badges are composited onto the strip image**, not drawn as separate
   elements. On a real wallet pass they *have* to be — Apple and Google both treat that
   band as a single image. Confirms the approach in the phased plan: generate the strip
   server-side as one PNG.

### Notable difference from us

Perkstar uses a **1D barcode (Code128)**; we use a QR code. Ours is the better call for
phone-camera scanning, and our scanner UI is already built around QR. Not changing it.

---

## 2. What we build — one editor, two entry points

The core rule, and the thing that keeps this simple:

> **A template is a named preset of design-token values. Applying a template *copies*
> those values into the card's own design object. It does not link to it.**

So there is exactly **one** editor. "Design your own" opens it with our default tokens.
"Start from a template" opens it with the template's tokens already filled in. From that
moment they are the merchant's values and every field stays editable. Editing a card can
never alter the template, and a later change to a template never rewrites a live card.

```
                    ┌──────────────────────┐
   "Design your own"│                      │
  ─────────────────►│                      │
                    │   The Card Editor    │──► program.config_json.design
   "Use a template" │  (colour, icon,      │    (a plain CardDesign object)
  ─────────────────►│   pattern, labels)   │
     seeds tokens   │                      │
                    └──────────────────────┘
                              ▲
                              │ live preview: Apple / Google / web
```

### The token set (`CardDesign`)

Lives in `packages/shared` so the web editor, the SVG renderer, and both wallet
builders all agree on one shape:

```ts
interface CardDesign {
  backgroundColor: string;      // solid body fill
  foregroundColor: string;      // primary text
  labelColor: string;           // field labels
  stampIcon: StampIconId;       // "cup" | "croissant" | "scissors" | ...
  stampFilledColor: string;
  stampEmptyColor: string;
  badgeStyle: "filled" | "outline" | "bare";
  pattern: PatternId | null;    // tiled motif behind the badges
  patternOpacity: number;
  titleText: string;
  progressLabel: string;        // "STAMPS UNTIL THE REWARD"
  rewardsLabel: string;         // "AVAILABLE REWARDS"
}
```

Stored in `loyalty_programs.config_json.design` — **no migration needed**, which is
exactly the polymorphism CLAUDE.md describes. Also store `template_id` and
`template_version` alongside it, used only for analytics and an optional
"reset to template" button.

### Templates as data, not art

```ts
export const CARD_TEMPLATES: Record<TemplateId, {
  name: string;          // "Coffee shop"
  industry: Industry;    // for gallery grouping
  version: number;
  design: CardDesign;
}> = { ... }
```

Static, in code, versioned, no DB table. A template is ~12 lines of JSON.

---

## 3. Pattern strategy — illustrated, but tintable

**Decision (2026-08-24): illustrated art assets, matching Perkstar's visual richness.**

Perkstar's patterns are full-colour raster illustrations, one per industry. That gets
them a high visual ceiling and costs them two things they live with: an art asset per
template, and a pattern locked to its palette — a merchant who changes brand colour ends
up with a strip that clashes with the card body.

We take the same illustrated approach but fix the second problem: author each motif as a
**single-colour vector (SVG) tile that is tinted at render time**.

- illustrated and distinctive, like theirs — this is not a generated fallback
- the motif takes the merchant's brand colour, so rebranding never clashes
- vector, so it rasterizes crisply at Apple @3x and Google hero sizes alike
- small text-based assets, versioned in git, no binary asset pipeline

Practically: an artist draws ~90 monochrome motif tiles; the renderer applies colour,
opacity and tiling. A full-colour photo strip stays available as a per-template override
for the handful where a photograph genuinely reads better (Furniture, Eye Lenses).

**On copying:** the industry list below is just categories and fine to mirror. The
motifs themselves must be **original illustrations** in a comparable style, not traced
or copied from Perkstar's artwork — that art is theirs.

---

## 4. Template list

**Decision (2026-08-24): mirror Perkstar's full catalogue.**

The 94 names below were read directly off the gallery capture, which runs alphabetically
from *ATV rental* to *Shawarma* and is continuous — no duplicated or skipped rows.

```
ATV rental · Art · Bags and Accessories · Bakery · Bar · Barbecue · Barber Shop ·
Bike rental · Billiard club · Bowling · Breakfast · Building materials · Burger House ·
Bus trip · Business lunch · Cab · Cafe · Car Service · Car Service 5 wheel · Car Wash ·
Car rental · Cinema · Cleaning service · Climbing wall · Clothing Shop ·
Co-working center · Coffee Shop · Cooking courses · Cosmetics · Dentistry · Depilation ·
Dry-cleaning · Education · Electrician · Entertainment · Equipment hire · Excursions ·
Eye Lenses · Eyebrow care · Eyelash Care · Fish restaurant · Fitness · Flower shop ·
Food Delivery · Food Truck · Furniture · Gas station · Gift shop · Go-karting ·
Goods for children · Goods for pets · Gym · Haircut · Handyman · Holidays · Hookah ·
Hostel · Hotel · Ice cream parlor · Jewelry · Kindergarten · Legal services · Lift ·
Loaders · Makeup · Massage parlor · Medical center · Music · Nail Salon · Night club ·
Optical Studio · Oriental cuisine · Pizzeria · Plastic windows and balconies · Plumber ·
Present · Printing house · Products · Pub · Quests · Rent · Rent a scooter ·
Rent an apartment · Rent parking · Rent rollers · Repair of equipment ·
Repair of premises · Restaurant · SPA salon · Sale of equipment · Sauna · Security ·
Services · Shawarma
```

### The missing tail

The capture stops at *Shawarma* — the full-page screenshot tool ran out before the
lazy-loading grid finished, so **T–Z was never captured**. The earlier tear-down in
PERKSTAR_ANALYSIS.md names some of what is missing: sushi, tennis court, swimming pool,
water delivery, transport, training, tourism, sport store, toys. Recovering the exact
tail needs one more visit to `app.perkstar.co.uk/cards/templates` scrolled to the end.

Estimate: ~110-115 templates total, so roughly 20 names still unknown.

### Build order

Do not build 94 at once. The engine is the same for all of them, so:

1. **Engine + 3 templates** (Coffee Shop, Barber Shop, Nail Salon) — proves the pipeline
   end to end on web, Apple and Google.
2. **The NL-first 16** — the verticals that actually sign up: cafe, bakery, restaurant,
   pizzeria, ice cream, barber, haircut, nail salon, cosmetics, massage, SPA, gym,
   fitness, car wash, goods for pets, bike rental.
3. **The remaining long tail**, in alphabetical batches as art lands.

Each template is a `CardDesign` preset plus a name, an icon and one motif tile. Once the
engine exists, adding one is a pull request, not a project.

---

## 5. Rendering — one source of truth

The same SVG generator feeds all three surfaces, so the grid can never drift:

| Surface | How |
|---|---|
| Web card page `/c/[qrToken]` | render the SVG inline |
| Apple Wallet | **shipped** — `renderCardStrip` → resvg → `strip.png` @1x/2x/3x via `pass.addBuffer()`, cached in `apps/api/src/card-art/raster.ts` |
| Google Wallet | not yet — needs a public cache-busted URL + `heroImage` on the object patch |
| Editor preview | the same SVG, in a phone frame |

Confirmed against the installed code: `pass.addBuffer(pathName, buffer)` exists in
passkit-generator 3.5.7, and `buildPkPass` already runs per device pull, so an Apple
pass picks up a design change on its next refresh with no extra plumbing.

---

## 6. Known gaps in the reference material

- **No screenshot of Perkstar's `Settings` or `Design` step.** The captures jump from
  Card type to the template gallery. Their per-field editor UI is unobserved — our
  editor layout is our own call, and the token list in §2 is derived from the rendered
  cards rather than from their form.
- **Template names T–Z are missing** (see §4). Needs one more capture.
- Source screenshots live at `~/Downloads/perkstar_images/` (not committed — ~48MB, and
  the gallery capture alone is 3420×28800). The five downscaled stills in `refs/` are
  the committed subset.
- `sips --cropOffset` measures from the top-left **only when the offset is non-zero**;
  an offset of `0` silently falls back to a centre crop. Cost an hour of confusion when
  slicing the tall capture — use `1` for the top band.
