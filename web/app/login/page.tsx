export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f9f8f6] px-4">
      <div className="w-full max-w-sm bg-white border border-[#E5E5E5] rounded-lg p-8">
        <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight">Barrel Site Audit</h1>
        <p className="mt-1 text-sm text-[#6B6B6B]">Enter the password to view reports.</p>

        <form action="/api/login" method="POST" className="mt-6 space-y-3">
          <input type="hidden" name="next" value={next ?? "/"} />
          <input
            type="password"
            name="password"
            autoFocus
            placeholder="Password"
            className="w-full rounded-lg border border-[#E5E5E5] px-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#9A9A9A] focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 focus:border-[#1A1A1A]"
          />
          {error && (
            <p className="text-sm text-[#B91C1C]">Incorrect password. Please try again.</p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg bg-[#1A1A1A] text-white text-sm font-medium py-2 hover:bg-black transition-colors"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
