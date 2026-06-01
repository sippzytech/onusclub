import type { StaffMember } from "@stampdeck/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { TeamList } from "./team-list";

export const dynamic = "force-dynamic";

export default async function TeamPage(): Promise<JSX.Element> {
  const { jwt, user, merchant } = await requireSession();
  const { staff } = await apiFetch<{ staff: StaffMember[] }>("/v1/staff", { jwt });
  const isOwner = user.role === "owner";

  return (
    <DashboardShell user={user} merchant={merchant}>
      <div className="space-y-8">
        <header className="space-y-2">
          <h2 className="text-lg font-medium text-gray-900">Team</h2>
          <p className="text-sm text-gray-600">
            Members who can sign in and use this dashboard. Staff can do everything
            an owner can — stamp, redeem, enrol customers, run broadcasts (premium).
          </p>
        </header>

        <TeamList staff={staff} currentUserId={user.id} isOwner={isOwner} />

        {!isOwner ? (
          <p className="text-xs text-gray-500">
            Only the owner can add or remove team members.
          </p>
        ) : null}
      </div>
    </DashboardShell>
  );
}
