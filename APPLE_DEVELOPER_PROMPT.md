# Prompt for Claude.ai — Individual Apple Developer enrollment for Apple Wallet passes

Copy everything below the `---` line and paste into a fresh Claude.ai chat. Replace the `[bracketed]` placeholders with your actual values.

---

I'm enrolling in the **Apple Developer Program as an Individual** (not Organization) and need a step-by-step walkthrough. Please be specific and current — not generic.

## My context

I'm building **Stampdeck**, a multi-tenant SaaS for digital loyalty cards for cafés and small businesses in the Netherlands. The product already has Google Wallet integration live in production at `app.sippzy.com`. I now want to add **Apple Wallet (`.pkpass`) support** so customers on iPhone can save their loyalty cards too.

Each customer of a café gets their own loyalty card pass, signed by my Apple Pass Type ID, but the pass *visually* shows the café's name, logo, and brand color — not mine. The Apple Developer signature is invisible to end users; it's just used to verify the pass authenticity.

## My situation

- Enrolling as **Individual** (not Organization). I don't want DUNS, I don't want to wait, I don't want to set up a company yet.
- Apple Developer Program fee is $99/year — fine.
- Based in **[your country — e.g. India / Netherlands]**.
- Apple ID I plan to use: **[your Apple ID email]** (which is/isn't already an existing personal Apple ID — let me know if that matters).
- I have access to a Mac for any required steps (Xcode, Keychain Access, etc.).
- I do **not** have an iPhone test device — please tell me if I need one or if a friend's phone / a simulator is enough.
- Backend stack: Node.js 20 + TypeScript. Passes will be generated server-side and emailed / saved via "Add to Apple Wallet" links.

## What I need from you (be specific and actionable)

### 1. Enrollment process
- Walk me through the exact current (2026) Individual enrollment flow on the Apple Developer site.
- What identity documents will Apple ask for? Government ID? Phone verification?
- Is there a phone interview with Apple, or is it fully automated?
- How long does it typically take from "submit" to "approved" for an Individual application in 2026?
- Common reasons Individual applications get held up or rejected, and how to avoid them.

### 2. Pre-enrollment checklist
- What should I have ready before clicking "Enroll"?
- Does my Apple ID need to be 2FA-enabled? Already verified phone?
- Tax info — Individual still requires a W-8 / W-9 / equivalent. What form, what info do I prepare?
- Payment method — credit card vs Apple Pay vs invoice billing. Which is fastest?

### 3. After enrollment: Apple Wallet pass setup
- Step-by-step: how do I create a **Pass Type ID** in the Apple Developer Console?
- Step-by-step: how do I generate the **Pass Type ID Certificate** (the .cer / .p12 file I need to sign passes)?
   - Where to generate the CSR (Certificate Signing Request)?
   - Where to upload it?
   - How to download the .cer and convert to .p12 / .pem for use on a Linux server?
- The Apple WWDR intermediate certificate — what is it, where do I get it, how do I bundle it with my signing cert?
- Do I need a separate cert per merchant in my SaaS, or can one Pass Type ID sign passes for many merchants? (I have 1000s of cafés potentially — one cert that signs all their passes is simplest.)

### 4. Generating and serving passes
- Recommended Node.js library for `.pkpass` generation in 2026 — what's actively maintained and works with current Apple Wallet specs?
- The pass JSON structure (`pass.json`) — minimum required fields for a loyalty card (`storeCard` pass type), and what each field controls visually.
- How to deliver the `.pkpass` to a customer:
  - Direct download link via HTTPS? Email attachment? `add-to-wallet` button?
  - Best practice for iOS Safari users (they tap a link and Wallet opens automatically — what content-type / file naming gets that to work)?
- How to **update an existing pass** when a stamp is added (similar to how Google Wallet's PATCH works) — does Apple use webhooks / web service push?

### 5. Apple's review process (or lack thereof) for Wallet passes
- Does Apple review Wallet pass apps the way they review App Store apps?
- Is there a "demo mode" / "test mode" like Google Wallet has where only approved test devices can save passes? Or do all iPhones immediately accept passes signed by my cert?
- Any restrictions on what can be in pass content (e.g. branding rules, prohibited content)?

### 6. Test devices
- Can I test pkpass generation without an iPhone? (I have a Mac and an Android.)
- iOS Simulator support for Wallet passes — works or not?
- If I need a real iPhone, what's the cheapest model that still works for current iOS? Can I borrow a friend's phone for occasional testing?

### 7. Cost beyond the $99/year
- Are there any other Apple fees I should expect?
- Hosting / signing certificate management costs?
- Anything Apple bills annually that's easy to forget?

### 8. Switching to Organization later
- If I eventually formalize my company and want to switch from Individual to Organization, what's the process?
- Do my existing pass type ID and signed passes carry over, or do they break?
- Can I transfer the developer account, or do I have to start fresh?

### 9. Gotchas / common mistakes
- What are the top 5 things first-time Individual enrollees mess up that I should pre-empt?
- Anything about working from outside the US that's different (I'm based in **[your country]**)?

### 10. After all this — produce a concrete next-step checklist
End your response with a numbered checklist of exactly what I should do **today** to start the enrollment, in order. Keep it under 10 steps.

## Format your answer

- Use clear headings matching the numbered sections above.
- Show command-line snippets (e.g. `openssl` commands for the CSR / .p12 conversion) where relevant.
- Don't repeat my context back to me — get straight to the answers.
- If something has changed in 2026 vs the older docs you might be trained on, flag it (e.g. *"As of 2025, Apple changed X — make sure you do Y."*).
- If you genuinely don't know something current, say so — don't hallucinate.
