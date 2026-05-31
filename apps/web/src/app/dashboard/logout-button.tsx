"use client";

export function LogoutButton(): JSX.Element {
  async function onClick(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <button
      onClick={() => void onClick()}
      className="text-sm text-gray-600 underline hover:text-gray-900"
    >
      Sign out
    </button>
  );
}
