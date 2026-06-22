import { SignupForm } from "./signup-form";

export default function SignupPage(): JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Create your OnUsClub account
          </h1>
          <p className="text-sm text-gray-600 mt-2">
            Pick a password and you&apos;re in. Onboarding help is just an email away.
          </p>
        </div>
        <SignupForm />
        <p className="text-xs text-gray-500">
          Already have an account?{" "}
          <a className="underline" href="/login">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
