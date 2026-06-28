import Link from "next/link";
import { ResetPasswordForm } from "./reset-form";

function BrandHeader(): JSX.Element {
  return (
    <div className="text-center">
      <div className="inline-flex items-center gap-2.5">
        <div className="h-9 w-9 rounded-md bg-brand-gold flex items-center justify-center">
          <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
            <path
              d="M4 10.5l3.5 3.5 8.5-8.5"
              stroke="#14271C"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="font-serif text-2xl text-brand-green tracking-tight">
          OnUsClub
        </span>
      </div>
    </div>
  );
}

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string };
}): JSX.Element {
  if (!searchParams.token) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-12 bg-brand-cream">
        <div className="w-full max-w-md">
          <div className="rounded-card bg-white border border-brand-green/10 p-8 space-y-4">
            <BrandHeader />
            <h1 className="font-serif text-2xl text-brand-green text-center">
              Reset link incomplete
            </h1>
            <p className="text-sm text-brand-olive text-center">
              The reset link is missing its token. Request a new one.
            </p>
            <Link
              className="block text-center text-sm text-brand-olive hover:text-brand-green underline-offset-4 hover:underline"
              href="/forgot-password"
            >
              Back to forgot password
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12 bg-brand-cream">
      <div className="w-full max-w-md">
        <div className="rounded-card bg-white border border-brand-green/10 p-8 space-y-6">
          <BrandHeader />
          <div className="text-center">
            <h1 className="font-serif text-3xl text-brand-green">
              Choose a new password
            </h1>
            <p className="text-sm text-brand-olive mt-2">
              At least 8 characters. After saving, you&apos;ll be signed in
              automatically.
            </p>
          </div>
          <ResetPasswordForm token={searchParams.token} />
        </div>
      </div>
    </main>
  );
}
