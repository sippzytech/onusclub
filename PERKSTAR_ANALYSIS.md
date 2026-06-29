# Perkstar Tear-Down — Feature Inventory + What to Copy

Written 2026-06-29 after walking through 18 dashboard screenshots from a paid Perkstar sandbox account (`app.perkstar.co.uk`). Source images live on Sanchit's personal Mac at `~/Desktop/perkstar_images/` (not committed — too large).

The goal of this doc: a single place to point at when planning Days 15+. Every feature in Perkstar is listed below, classified as **COPY** (worth shipping), **DEFER** (next phase), or **SKIP** (low ROI for OnUsClub). Where the analysis is non-obvious, the "Why" line explains the call.

---

## TL;DR — the single biggest lever

**Optional transaction-amount entry at scan time** unlocks every monetary number on Perkstar's dashboard. They are NOT integrated to POS — the merchant types a sale amount when scanning, and from that one data point Perkstar derives revenue, ROI, AOV, RFM, segment revenue, and member-cohort revenue.

Cost for us: one input field on the scanner + one column on `card_events.amount_cents` + a few aggregates. **This is the highest-value, lowest-cost item on the entire list.** Build it first; everything else benefits.

---

## Full feature inventory (everything Perkstar has)

### 1. Dashboard / Analytics ⭐
Their headline screen. Date-range switcher: Today / 7d / 4w / 6m / 12m / MTD / custom period.

- **Revenue cards** — Total revenue, Added revenue, Total investment, ROI, AOV
- **Members revenue breakdown** — Repeated / New / Referral / Unknown
- **Investment breakdown** — Platform payment + Rewards cost = Profit
- **Trends** — Visits, Revenue, Active customers, Average spend
- **Performance** — Retention rate, Engagement rate, Churn rate, Time activity
- **Demographics** — New customers by month, Card installation channels, Age, Gender
- **Top members** — by revenue / by visits
- **RFM segments analytics** — count + revenue + purchases per segment
- **Points analytics, Rewards analytics**
- **Referral analytics** — cards installed via referral, redeemed, new referred members
- **Real-time activity feed** — last events
- **Reputation** — feedback rating, total feedback, Google reviews collected

### 2. Customers
- Customer base with summary cards: Customers total / Cards installed / Cards transactions / Feedback rating
- Filter chips: My Filters / My Segments / Health / Loyalty / RFM-segments / Communication / custom +
- Table columns: name, created, birthdate, phone, feedback rating, UTM, device, customer cards
- Add customer modal (last name, first name, phone with country code, email, DOB)
- **Import / Export** (CSV)
- **Feedbacks tab**

### 3. Messaging
Way bigger than our current `/dashboard/messages` page.

- **Inbox** — sub-folders: Your conversations / Favorites / Sent / Received / Opened / Unread / Replied. It's a 2-way chat surface (customer reply to push → conversation thread)
- **Mailings → Send push** — composer with iPhone live preview pane
- **Push automation** — event-triggered ("This function is not available on your plan Starter" → premium-gated)
- **Custom auto-push** — user-defined rules: event → wait time → message (also premium-gated)
- Targeting: For all customers / Selected segment
- Schedule push for later

### 4. Card builder ⭐
- 9 program types organized as marketing groups:
  - **High retention**: Stamp, Reward, Membership
  - **Best for acquisition**: Discount, Cashback, Coupon
  - **Other**: Multipass, Gift card, Points
- **100+ industry-specific templates** — pre-designed iPhone wallet card mockups for: cafe, bakery, dentist, gym, salon, sushi, tennis court, swimming pool, water delivery, transport, training, tourism, hotel, sport store, toys, etc. Massive library — every conceivable SMB vertical has one.
- Live iPhone preview side-by-side while you edit

### 5. Locations + Geo-push (iOS only)
- Add location with Google Maps picker
- Radius 100m default (330 ft on Starter plan)
- Push message triggered when customer phone enters the geofence
- Apply to specific cards
- Plan-gated by number of locations

### 6. Managers (= our Team page)
- Table: user name, created, notes, location, status
- **Scanner App** link → installable PWA
- Download report
- Add manager

### 7. Scanner App
- PWA at `app.perkstar.co.uk/scanner-app/en-GB` — installable on staff phones
- Staff login displayed at top
- Scan button + Search customers button
- Lightweight, separate from main dashboard

### 8. Settings
Tabs: Plan / Personal settings / Services / About us / RFM / Notifications

- **Notifications** — Weekly stats report (email + Telegram bot option), Customer transactional emails toggle
- **RFM settings** — editable frequency-from/to + recency-from/to sliders for **9 segments**:
  - Need attention, Loyal-Regular, Champions
  - At risk, Medium-borderline, Growths
  - Sleeping, Doubtful, Beginners

### 9. Tier gating / Monetisation
- Soft-wall design throughout: features show with "This function is not available on your plan Starter" + "Select plan" CTA
- Persistent "Sandbox" banner across the entire top of every page while in trial
- "To sandbox account" toggle in the profile menu

---

## How Perkstar shows revenue without POS integration

Short answer: **they don't integrate to POS — the merchant types the transaction amount manually at scan time.**

Long answer:
- Every monetary value in the sandbox shows `US$0` because no transactions have been entered
- "Total investment = Platform payment + Rewards cost" — both are values Perkstar already knows (subscription price + the configured reward value × redemptions)
- "Added revenue", "AOV", "Repeated/New/Referral/Unknown members revenue" can only exist if the merchant inputs sale amounts somewhere
- The only place that makes UX sense is: **at scan time** the staff member optionally enters the sale amount, which Perkstar attributes to that customer's visit
- **ROI** = (sum of attributed loyalty-member revenue) ÷ (subscription + rewards given away)

The honesty trade-off: it's a merchant-estimated number sold as a precise one. That's fine — merchants want directional signal, not GAAP accounting. And the friction is one number per scan — well within "I'll do this if it gives me a real dashboard."

This is the lever that turns our currently-empty Overview page into a screen we can actually demo.

---

## Classification: COPY / DEFER / SKIP

### ✅ COPY — ship this phase (high value, manageable cost)

| # | Feature | Effort | Why it matters |
|---|---|---|---|
| 1 | **Optional transaction amount at scan** ⭐ | 1 day | Unlocks revenue, ROI, AOV, RFM, segment math. The unblocker for half this list. |
| 2 | **CSV customer import / export** | 0.5 day | Cafes have spreadsheets from prior tools. One endpoint + a small upload UI using `papaparse`. |
| 3 | **Industry template gallery (10-15 designs)** | 2-3 days | Most cafes / salons / etc. don't want to design from scratch. 10 OnUsClub-branded card templates beats one default. Bonus: each template is a marketing asset. |
| 4 | **Weekly merchant digest email** (already in polish backlog) | 2-3 h | "This week: 12 new cards, 47 stamps, 3 redeems". Stickiness + retention. |
| 5 | **Real-time activity feed on Overview** | 2-3 h | We already log `card_events`. Render the last 10 in the empty space on the new dashboard. Makes the page feel alive. |
| 6 | **Add customer modal polish** | 1 h | We have add-customer; align the field set to Perkstar's (last name, first name, phone w/ country code, email, DOB) so import/export round-trips cleanly. |
| 7 | **Sale-amount column on `card_events`** | 0.5 day | Migration `008_card_event_amount.sql` — single column `amount_cents BIGINT NULL`. Dependency for #1. |

### 🕐 DEFER — next phase (high value, real work)

| # | Feature | Effort | Why defer |
|---|---|---|---|
| 8 | **RFM segments (9 buckets)** | 2-3 days | Needs revenue data first → blocked by #1. Then it's SQL bucketing + a settings page for the thresholds. |
| 9 | **Push automation rules** ("event → wait → message") | 4-5 days | Needs a real rules engine + scheduler. Big feature; not a quick win. |
| 10 | **Referral tracking** | 2 days | Adds `referred_by_card_id` column + share link + dashboard view. Worth it for organic growth, not urgent. |
| 11 | **UTM tracking on enrol form** | 0.5 day | One column on `customers`, propagates from public landing page. Easy but unblocks #10's attribution. |
| 12 | **Geo-push (Apple Wallet `locations[]`)** | 2-3 days | PassKit supports it natively now that Day 11/12 shipped. UX/permission story is messy. Phase 3. |
| 13 | **Two-way push reply / Inbox** | 5+ days | Only works on Google Wallet (Apple Wallet doesn't allow replies). Skewed value/cost — defer. |
| 14 | **Tier system + soft-walls everywhere** | 3-4 days | Pairs with Stripe billing. Build the gate UI when we build billing. |
| 15 | **Scanner PWA (installable)** | 2-3 days | We already have `/dashboard/scan`. Making it a standalone PWA at e.g. `scan.onusclub.com` is mostly manifest + service worker + standalone shell. Defer to when staff complain. |
| 16 | **Feedback / Google Reviews loop** | 4-5 days | After redeem → push for review → optional Google Business Profile API integration. Big feature; deserves its own week. |

### ❌ SKIP — low ROI for OnUsClub

| Feature | Why skip |
|---|---|
| Multipass, Gift card, Cashback, Coupon as separate program types | We cover the same use cases with Stamp + Points already. Adding them as separate types is marketing dressing; the underlying engine is identical. If a customer asks, we add. |
| Telegram bot for stats reports | Niche. Email digest covers it. |
| Persistent "Sandbox" top banner | Looks unprofessional. Use a smaller pill instead. |
| 100+ templates | Diminishing returns past ~15. Start with 10, grow organically. |
| Customer "Feedback rating" stars on the customer table | Without a feedback collection feature first, this column is empty noise. Build feedback first (item #16), then add the column. |

---

## Recommendation — concrete next-step bundle

**Day 15 (proposed): "Revenue capture + dashboard come-alive"**

Ship items 1, 5, 6, 7 from the COPY list as one bundle:
- Migration `008_card_event_amount.sql` — `amount_cents BIGINT NULL`
- Scanner state machine gets an optional "Sale amount (€)" prompt step (skippable)
- Same field on the manual `/dashboard/cards/[id]` stamp/redeem buttons
- Overview page renders: recent activity feed + revenue card (sum of `amount_cents` last 7d / 30d) + AOV card
- Migration backfill: existing card_events get `NULL` (interpreted as "no amount captured")

Estimated: 1.5-2 days end-to-end including smoke test additions.

**After that, in priority order:**
- Day 16: CSV import/export (item #2) + add-customer field alignment (#6)
- Day 17: RFM segments (item #8) — now possible because Day 15 captured the data
- Day 18: Industry template gallery (item #3)
- Day 19: Weekly digest email (item #4) — already in polish backlog
- Later: referral (#10) + UTM (#11) as a bundle

Stripe billing remains the "last part" per user's earlier direction — slot it whenever feels right.

---

## Open questions for Sanchit

1. Should the transaction-amount step be **opt-in per program** (some merchants won't want it) or **always-on but skippable per scan**? Recommend the latter — zero merchant config, max data capture.
2. Currency: keep `amount_cents` integer or store currency code per merchant? Recommend integer cents + a `merchants.currency_code` column (default EUR).
3. RFM thresholds: copy Perkstar's defaults (Champions: 8-12 freq / 0-30d recency) or pick our own NL-cafe-tuned defaults? Recommend Perkstar's as v1 — editable on the settings page so merchants can tune.
4. Do we want the Inbox / 2-way reply feature ever, or is one-way push enough? My take: skip permanently. Push reply is a Google Wallet feature; Apple Wallet doesn't have it. Investing in a feature that only works on half our users isn't worth it.
