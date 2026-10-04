# `/contact` page for onusclub.com — ready to drop in

**Backlog item 21.** This is the handover for a change that **cannot be made from this
repo**: `onusclub.com` is a separate Netlify site, not part of this monorepo. Everything
below is the content and the reasoning; the deploy is manual.

## Why it matters

The support URL registered with Google for the Wallet issuer points at the **homepage**,
not a contact page. A reviewer looking for how a customer reaches support finds a marketing
page. It is cosmetic until someone looks, and the person who looks is a Google reviewer.

Separately, **`support@onusclub.com` appears 14 times** across Privacy, Terms and the GDPR
section as the contact for data-subject requests. That address was deliberately left alone
when lead notifications moved to `onusclub.official@gmail.com`, on the grounds that if the
mailbox does not work the fix is to make it work, not to point legal documents at a Gmail.

> ⚠️ **Before publishing this page, send a test email to `support@onusclub.com` from an
> outside address and confirm it arrives.** Nobody has verified it. A contact page
> advertising a dead mailbox is worse than no contact page — and under GDPR that address is
> how a data subject exercises their rights, so a bounce there is a compliance problem, not
> an inconvenience.
>
> If it does not work, the options in order of preference: set up forwarding on the domain
> to a mailbox you read; or change all 14 references to an address that works. Do **not**
> publish the page until one of those is true.

## Content

Deliberately short. A contact page's job is to make it obvious how to reach a human and
roughly when to expect a reply — not to be a second landing page. No form: a form needs a
backend, and a lead form already exists elsewhere on the site. `mailto:` works everywhere
and needs nothing.

```html
<!-- /contact -->
<section>
  <h1>Contact OnUsClub</h1>

  <p>
    We're a small team in the Netherlands building digital loyalty cards for cafés
    and local businesses. Email is the fastest way to reach us.
  </p>

  <h2>Support</h2>
  <p>
    Already using OnUsClub, or something not working?<br>
    <a href="mailto:support@onusclub.com">support@onusclub.com</a>
  </p>
  <p>
    We answer within one working day, Monday to Friday, Central European Time.
  </p>

  <h2>Sales and questions</h2>
  <p>
    Wondering whether it fits your business? Email the same address and say a
    little about your shop — we'll tell you honestly if it's not a fit.
  </p>

  <h2>Privacy and your data</h2>
  <p>
    To access, correct or delete your personal data, email
    <a href="mailto:support@onusclub.com">support@onusclub.com</a> with "Data
    request" in the subject. We respond within 30 days, as required under the
    GDPR. See our <a href="/privacy">Privacy Policy</a> for the detail.
  </p>

  <h2>Business details</h2>
  <p>
    On Us Club<br>
    Eindhoven, Netherlands<br>
    KvK 42143962
  </p>
</section>
```

Adjust the markup to the site's existing components — the content is the point, not the
tags. Two things worth keeping as written:

- **The response-time promise.** "Within one working day" is a commitment; soften it if you
  cannot keep it, but say *something*. A contact page with no expectation set is the reason
  people email twice.
- **The separate data-request section with the 30-day window.** That is the GDPR
  obligation the legal pages already reference, and it belongs where someone looking for it
  will actually land.

## After publishing

1. **Link it from the footer**, next to Privacy and Terms.
2. **Update the Google-registered support URL** to `https://onusclub.com/contact`:
   Google Pay & Wallet Console → your issuer (`3388000000023208694`) → the business/contact
   details section → replace the homepage URL.
3. Confirm `https://onusclub.com/contact` returns 200 — `scripts/verify-deploy.sh` checks
   the app and api, not the marketing site, so this one is by hand.

## Also outstanding on the marketing site

**The trial copy can be restored.** Primary CTAs were softened from
*"Start 14-day free trial"* to *"Get started free"* on 2026-10-03, because no trial
mechanism existed. **Trials shipped** — `merchants.trial_ends_at`, per-merchant length,
with a banner in the dashboard — so the site is now *under*-promising a feature you have.
Restoring the original wording is truthful again, and it is a stronger CTA.
