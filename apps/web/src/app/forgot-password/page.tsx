import { ForgotPasswordForm } from "./forgot-form";

export default function ForgotPasswordPage(): JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Reset your password
          </h1>
          <p className="text-sm text-gray-600 mt-2">
            Enter your email and we&apos;ll send you a link to set a new password.
          </p>
        </div>
        <ForgotPasswordForm />
        <p className="text-xs text-gray-500">
          Remembered it?{" "}
          <a className="underline" href="/login">
            Back to sign in
          </a>
        </p>
      </div>
    </main>
  );
}
