export function EditorAreaSkeleton() {
  return (
    <div className="h-full border border-white/[0.06] rounded-xl bg-zinc-950 p-6 animate-pulse">
      <div className="space-y-4">
        {Array.from({ length: 12 }).map((_, index) => (
          <div
            key={index}
            className={`h-4 rounded bg-white/[0.04] border border-white/[0.06] ${
              index % 3 === 0 ? 'w-10/12' : index % 3 === 1 ? 'w-11/12' : 'w-8/12'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export function SuggestionPanelSkeleton() {
  return (
    <div className="h-full border border-white/[0.06] rounded-xl bg-zinc-950 p-4 animate-pulse space-y-3">
      <div className="h-6 w-24 rounded bg-white/[0.04] border border-white/[0.06]" />
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
          <div className="h-4 w-1/3 rounded bg-white/[0.04] border border-white/[0.06]" />
          <div className="h-4 w-full rounded bg-white/[0.04] border border-white/[0.06]" />
          <div className="h-4 w-2/3 rounded bg-white/[0.04] border border-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}
