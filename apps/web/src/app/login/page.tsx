import { LoginForm } from "./login-form";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}): JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Sign in to Stampdeck
          </h1>
          <p className="text-sm text-gray-600 mt-2">
            Enter your email and we&apos;ll send you a magic link.
          </p>
        </div>
        {searchParams.error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Sign-in failed: {searchParams.error}. Please request a fresh link.
          </div>
        ) : null}
        <LoginForm />
        <p className="text-xs text-gray-500">
          New here?{" "}
          <a className="underline" href="/signup">
            Create an account
          </a>
        </p>
      </div>
    </main>
  );
}
