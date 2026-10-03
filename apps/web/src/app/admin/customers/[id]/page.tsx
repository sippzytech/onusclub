import Link from "next/link";
import { notFound } from "next/navigation";
import { centsToEuroString, type AdminCustomerDetail } from "@onusclub/shared";
import { apiFetch, ApiCallError } from "@/lib/api";
import { requireAdminSession } from "@/lib/admin-session";
import { AdminShell } from "../../admin-shell";
import { EVENT_LABEL } from "../../event-label";

export const dynamic = "force-dynamic";

export default async function AdminCustomerPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const { jwt, admin } = await requireAdminSession();

  let detail: AdminCustomerDetail;
  try {
    detail = await apiFetch<AdminCustomerDetail>(`/v1/admin/customers/${params.id}`, { jwt });
  } catch (err) {
    if (err instanceof ApiCallError && err.status === 404) notFound();
    throw err;
  }

  const c = detail.customer;

  return (
    <AdminShell
      admin={admin}
      breadcrumb={
        <Link href={`/admin/merchants/${c.merchantId}`} className="underline">
          {c.merchantName}
        </Link>
      }
      title={c.name ?? "Unnamed customer"}
    >
      <div className="grid lg:grid-cols-3 gap-4">
        <section className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-medium text-slate-900 mb-2">Contact</h2>
          <dl className="text-sm space-y-1.5">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Email</dt>
              <dd className="text-slate-900 break-all">{c.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Phone</dt>
              <dd className="text-slate-900">{c.phone ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Joined</dt>
              <dd className="text-slate-900">{c.createdAt.slice(0, 10)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Visits</dt>
              <dd className="text-slate-900 tabular-nums">{c.visits}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Last visit</dt>
              <dd className="text-slate-900">
                {c.lastVisitAt ? c.lastVisitAt.slice(0, 10) : "never"}
              </dd>
            </div>
          </dl>

          {detail.alsoMemberAt.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-600">
                Same email or phone at {detail.alsoMemberAt.length} other café
                {detail.alsoMemberAt.length === 1 ? "" : "s"}
                {/* A hint, not a merge — these are separate customer records
                    at separate tenants and stay that way. */}
                <span className="block text-[11px] text-slate-400 mt-0.5">
                  Separate records — nothing is shared between cafés.
                </span>
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {detail.alsoMemberAt.map((a) => (
                  <li key={a.customerId}>
                    <Link
                      href={`/admin/customers/${a.customerId}`}
                      className="text-slate-700 underline"
                    >
                      {a.merchantName}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-xl bg-white border border-slate-200 p-5 lg:col-span-2">
          <h2 className="text-sm font-medium text-slate-900 mb-2">
            Cards <span className="text-slate-400">({detail.cards.length})</span>
          </h2>
          {detail.cards.length === 0 ? (
            <p className="text-sm text-slate-600">
              This customer exists but holds no card — usually an import that was
              never enrolled on a program.
            </p>
          ) : (
            <ul className="space-y-2">
              {detail.cards.map((card) => (
                <li
                  key={card.id}
                  className="rounded-lg border border-slate-200 px-4 py-3 hover:border-slate-400 transition-colors"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link
                      href={`/admin/cards/${card.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {card.programName}
                    </Link>
                    <span className="text-[11px] rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                      {card.programType}
                    </span>
                    {card.status !== "active" && (
                      <span className="text-[11px] text-amber-700">{card.status}</span>
                    )}
                    <span className="ml-auto tabular-nums text-slate-900">
                      {card.balanceLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {card.rewardText}
                    {" · "}
                    {/* The thing a merchant most often wants explained:
                        "why didn't my customer get the notification". */}
                    {card.hasGooglePass || card.appleRegistrations > 0 ? (
                      <span className="text-emerald-700">
                        in wallet
                        {card.hasGooglePass && " (Google)"}
                        {card.appleRegistrations > 0 &&
                          ` (Apple ×${card.appleRegistrations})`}
                      </span>
                    ) : (
                      <span className="text-amber-700">
                        never saved to a phone — no push notifications reach them
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl bg-white border border-slate-200 p-5 mt-4">
        <h2 className="text-sm font-medium text-slate-900">
          Full timeline <span className="text-slate-400">({detail.events.length})</span>
        </h2>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Every event across all of this customer&apos;s cards, newest first. Capped at 200.
        </p>
        {detail.events.length === 0 ? (
          <p className="text-sm text-slate-600 mt-2">Nothing has happened on this customer yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {detail.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                <span
                  className={
                    e.eventType === "manual_adjust"
                      ? "text-amber-800 font-medium"
                      : "text-slate-900"
                  }
                >
                  {EVENT_LABEL[e.eventType] ?? e.eventType}
                </span>
                <span className="text-[11px] text-slate-400">{e.programName}</span>
                {e.note ? <span className="text-xs text-slate-600">{e.note}</span> : null}
                {e.actorEmail ? (
                  <span className="text-[11px] text-slate-500">by {e.actorEmail}</span>
                ) : null}
                <span className="ml-auto text-slate-500 tabular-nums whitespace-nowrap">
                  {e.amountCents !== null && <>{centsToEuroString(e.amountCents)} · </>}
                  {e.createdAt.slice(0, 16).replace("T", " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
