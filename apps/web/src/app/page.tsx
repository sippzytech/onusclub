export default function HomePage(): JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-xl text-center space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Sippzy · Stampdeck
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-gray-900">
          Loyalty cards your customers will actually carry.
        </h1>
        <p className="text-gray-600">
          Stamp cards, points, memberships — straight into Google Wallet. Built
          for Dutch SMBs.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <a
            href="/signup"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Create account
          </a>
          <a
            href="/login"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100"
          >
            Sign in
          </a>
        </div>
      </div>
    </main>
  );
}
