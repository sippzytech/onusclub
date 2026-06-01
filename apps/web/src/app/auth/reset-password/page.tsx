import { ResetPasswordForm } from "./reset-form";

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string };
}): JSX.Element {
  if (!searchParams.token) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-4">
          <h1 className="text-xl font-semibold text-gray-900">
            Reset link incomplete
          </h1>
          <p className="text-sm text-gray-600">
            The reset link is missing its token. Request a new one.
          </p>
          <a className="underline text-sm" href="/forgot-password">
            Back to forgot password
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Choose a new password
          </h1>
          <p className="text-sm text-gray-600 mt-2">
            At least 8 characters. After saving, you&apos;ll be signed in
            automatically.
          </p>
        </div>
        <ResetPasswordForm token={searchParams.token} />
      </div>
    </main>
  );
}
