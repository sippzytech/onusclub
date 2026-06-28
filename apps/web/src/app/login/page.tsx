import Link from "next/link";
import { LoginForm } from "./login-form";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}): JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12 bg-brand-cream">
      <div className="w-full max-w-md">
        <div className="rounded-card bg-white border border-brand-green/10 p-8 space-y-6">
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
            <h1 className="font-serif text-3xl text-brand-green mt-6">Welcome back</h1>
            <p className="text-sm text-brand-olive mt-2">
              Sign in to your loyalty dashboard.
            </p>
          </div>

          {searchParams.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              Sign-in failed: {searchParams.error}. Please request a fresh link.
            </div>
          ) : null}

          <LoginForm />

          <div className="flex items-center justify-between text-xs text-brand-olive pt-2">
            <Link className="hover:text-brand-green underline-offset-4 hover:underline" href="/forgot-password">
              Forgot password?
            </Link>
            <Link className="hover:text-brand-green underline-offset-4 hover:underline" href="/signup">
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
