// Thin top ribbon shown only on non-production builds (VITE_APP_ENV=staging),
// so nobody mistakes demo data for the real thing.
const env = import.meta.env.VITE_APP_ENV as string | undefined

export function EnvBanner() {
  if (!env || env === 'production') return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[100] bg-amber-500 px-3 py-0.5 text-center text-[11px] font-semibold uppercase tracking-wider text-black"
    >
      {env} environment, test data only
    </div>
  )
}
