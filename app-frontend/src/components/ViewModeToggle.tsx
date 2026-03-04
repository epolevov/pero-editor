import { useEditorStore } from '../store/editorStore';

export function ViewModeToggle() {
  const { viewMode, setViewMode } = useEditorStore();

  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-zinc-900 p-1"
      role="group"
      aria-label="Режим просмотра"
    >
      <button
        type="button"
        onClick={() => setViewMode('desktop')}
        aria-pressed={viewMode === 'desktop'}
        className={`rounded-lg border px-3 py-1.5 text-xs transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
          viewMode === 'desktop'
            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
            : 'border-white/[0.06] text-zinc-300 hover:text-zinc-100'
        }`}
      >
        Компьютер
      </button>

      <button
        type="button"
        onClick={() => setViewMode('mobile')}
        aria-pressed={viewMode === 'mobile'}
        className={`rounded-lg border px-3 py-1.5 text-xs transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
          viewMode === 'mobile'
            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
            : 'border-white/[0.06] text-zinc-300 hover:text-zinc-100'
        }`}
      >
        Телефон
      </button>
    </div>
  );
}
