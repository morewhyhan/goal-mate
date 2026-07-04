export default function DashboardLoading() {
  return (
    <div className="mx-auto min-h-screen max-w-[1180px] px-4 py-5 md:px-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <div className="h-4 w-20 animate-pulse rounded-full bg-stone-200" />
          <div className="mt-3 h-8 w-56 animate-pulse rounded-2xl bg-stone-200" />
        </div>
        <div className="h-10 w-28 animate-pulse rounded-full bg-stone-200" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="h-5 w-32 animate-pulse rounded-full bg-stone-200" />
          <div className="mt-6 h-20 animate-pulse rounded-[24px] bg-stone-100" />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="h-32 animate-pulse rounded-[24px] bg-stone-100" />
            <div className="h-32 animate-pulse rounded-[24px] bg-stone-100" />
            <div className="h-32 animate-pulse rounded-[24px] bg-stone-100" />
            <div className="h-32 animate-pulse rounded-[24px] bg-stone-100" />
          </div>
        </section>

        <aside className="space-y-4">
          <div className="h-44 animate-pulse rounded-[28px] border border-stone-200 bg-white shadow-sm" />
          <div className="h-52 animate-pulse rounded-[28px] border border-stone-200 bg-white shadow-sm" />
        </aside>
      </div>
    </div>
  )
}
