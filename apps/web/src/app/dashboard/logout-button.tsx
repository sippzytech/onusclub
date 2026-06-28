"use client";

export function LogoutButton(): JSX.Element {
  async function onClick(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <button
      onClick={() => void onClick()}
      className="hidden sm:inline text-xs text-brand-olive hover:text-brand-green transition-colors underline-offset-4 hover:underline"
    >
      Sign out
    </button>
  );
}
