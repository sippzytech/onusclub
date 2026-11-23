import Link from "next/link";
import type { CardDesign, Customer, MerchantBranding, Program } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { CreateProgramForm } from "../create-program-form";
import { DesignEditor } from "../card-builder/design-editor";
import { QrShareCard } from "../qr-share-card";
import { SetupShell } from "./setup-shell";

export const dynamic = "force-dynamic";

/**
 * Guided first-run setup — one decision per screen.
 *
 * WHY THIS EXISTS
 *
 * A real café owner was handed the finished dashboard the moment he signed
 * up: nine navigation items, four empty stat cards, a QR code for a signup
 * page with nothing to sign up to, and no indication of which of those he was
 * supposed to deal with first. His words were "the main and big confusing
 * part is onboarding a café". The product was not missing features; it was
 * showing all of them at once to someone who had not yet made a single
 * decision.
 *
 * 🚨 EVERY STEP IS DERIVED FROM REAL STATE. No "setup_completed" column, no
 * cookie, no progress counter. Same rule as the Overview checklist, for the
 * same reasons: nothing to migrate, nothing that can desync, and a café that
 * deletes its only offer correctly finds itself back at step one.
 *
 * It also means pressing Save anywhere in here advances the wizard by itself,
 * because the thing the step was waiting for has actually happened. That is
 * the fix for the second complaint: he customised his card, pressed Save,
 * and the screen simply stayed put with no hint of what came next.
 *
 * ⚠️ This page does NOT trap anyone. Every screen carries a way out to the
 * full dashboard, and the Overview checklist is still there for whoever takes
 * it. A wizard you cannot leave is a worse kind of confusion than the one it
 * replaced.
 */

interface ProgramConfig {
  stamps_required?: number;
  points_for_reward?: number;
  design?: Partial<CardDesign>;
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: { step?: string };
}): Promise<JSX.Element> {
  const { jwt, user, merchant, publicSlug, preferences, trial } = await requireSession();

  const [{ programs }, { customers }] = await Promise.all([
    apiFetch<{ programs: Program[] }>("/v1/programs", { jwt }),
    apiFetch<{ customers: Customer[] }>("/v1/customers", { jwt }),
  ]);

  // Allowed to fail, exactly as on Overview — a missing branding endpoint
  // must not take down the page an owner needs in order to get started.
  const branding = await apiFetch<MerchantBranding>("/v1/me/branding", { jwt }).catch(
    () => null
  );

  const first = programs[0] ?? null;
  const cfg = (first?.configJson ?? null) as ProgramConfig | null;

  // "They designed the card" is a real, readable fact: the editor writes a
  // design object into config_json on Save. Before that the key is absent and
  // the card renders from defaults. No flag needed.
  const hasDesign = Boolean(cfg?.design && Object.keys(cfg.design).length > 0);

  const done = [
    programs.length > 0,
    hasDesign,
    customers.length > 0,
  ];
  const total = done.length;
  const completed = done.filter(Boolean).length;

  // The step to land on: the first unfinished one. `?step=` overrides it so
  // someone can go back and change an earlier answer, but it can never point
  // past the end.
  const firstUnfinished = done.findIndex((d) => !d);
  const natural = firstUnfinished === -1 ? total - 1 : firstUnfinished;
  const requested = Number(searchParams.step);
  const step =
    Number.isInteger(requested) && requested >= 0 && requested < total
      ? requested
      : natural;

  const allDone = completed === total;

  return (
    <SetupShell
      businessName={merchant.businessName}
      step={step}
      completed={completed}
      total={total}
      done={done}
      allDone={allDone}
    >
      {step === 0 ? (
        <section>
          <h2 className="font-serif text-2xl text-brand-green">
            What do your customers collect?
          </h2>
          <p className="text-sm text-brand-olive mt-2 max-w-xl">
            This is your offer — the deal you give people for coming back. Most
            cafés start with something like{" "}
            <span className="text-brand-green">
              &ldquo;collect 6 stamps, get a free coffee&rdquo;
            </span>
            . You can change it later.
          </p>
          <div className="mt-5 max-w-xl">
            <CreateProgramForm />
          </div>
          {programs.length > 0 ? (
            <p className="mt-4 text-sm text-brand-green">
              ✓ {programs.length} offer{programs.length === 1 ? "" : "s"} created.
            </p>
          ) : null}
        </section>
      ) : null}

      {step === 1 ? (
        <section>
          <h2 className="font-serif text-2xl text-brand-green">
            Make the card look like your café
          </h2>
          <p className="text-sm text-brand-olive mt-2 max-w-xl">
            This is exactly what your customer sees on their phone. Pick a
            template or change the colours — then press{" "}
            <span className="text-brand-green">Save design</span> and we&apos;ll
            move on.
          </p>
          {first ? (
            <div className="mt-5">
              <DesignEditor
                programId={first.id}
                programName={first.name}
                businessName={merchant.businessName}
                rewardText={first.rewardText}
                programType={first.programType === "points" ? "points" : "stamp"}
                target={
                  first.programType === "points"
                    ? (cfg?.points_for_reward ?? 0)
                    : (cfg?.stamps_required ?? 0)
                }
                initialDesign={cfg?.design ?? {}}
              />
            </div>
          ) : (
            <p className="mt-4 text-sm text-brand-olive">
              Create an offer first —{" "}
              <Link href="/dashboard/setup?step=0" className="underline">
                go back a step
              </Link>
              .
            </p>
          )}

          {!branding?.logoUrl ? (
            <p className="mt-6 rounded-lg border border-brand-green/15 bg-brand-cream/40 p-4 text-sm text-brand-olive">
              Your logo is set once for the whole café, in{" "}
              <Link href="/dashboard/settings" className="underline text-brand-green">
                Settings
              </Link>
              . Until you add one, passes show the OnUsClub badge instead of
              yours.
            </p>
          ) : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <h2 className="font-serif text-2xl text-brand-green">
            Get your first customer on the card
          </h2>
          <p className="text-sm text-brand-olive mt-2 max-w-xl">
            Print this and put it on your counter. People scan it with their
            phone camera, fill in their details, and the card lands straight in
            their wallet — no app to download.
          </p>

          {publicSlug ? (
            <div className="mt-5 rounded-card border border-brand-green/10 p-5">
              <QrShareCard publicUrl={publicUrlFor(publicSlug)} />
            </div>
          ) : null}

          <p className="mt-5 text-sm text-brand-olive">
            Or{" "}
            <Link
              href="/dashboard/customers"
              className="underline text-brand-green"
            >
              add someone by hand
            </Link>{" "}
            — useful for trying it on your own phone first.
          </p>

          {customers.length > 0 ? (
            <p className="mt-4 text-sm text-brand-green">
              ✓ {customers.length} customer{customers.length === 1 ? "" : "s"} so far.
            </p>
          ) : null}
        </section>
      ) : null}
    </SetupShell>
  );
}

function publicUrlFor(slug: string): string {
  const base = process.env.NEXT_PUBLIC_WEB_BASE ?? "http://localhost:3001";
  return `${base.replace(/\/$/, "")}/m/${slug}`;
}
