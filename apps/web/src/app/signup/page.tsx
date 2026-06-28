import Link from "next/link";
import { SignupForm } from "./signup-form";

export default function SignupPage(): JSX.Element {
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
            <h1 className="font-serif text-3xl text-brand-green mt-6">
              Create your account
            </h1>
            <p className="text-sm text-brand-olive mt-2">
              Pick a password and you&apos;re in.
            </p>
          </div>
          <SignupForm />
          <p className="text-xs text-brand-olive text-center">
            Already have an account?{" "}
            <Link
              className="hover:text-brand-green underline-offset-4 hover:underline"
              href="/login"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
