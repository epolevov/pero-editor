import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface UnsavedChangesModalProps {
  open: boolean;
  title: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSaveAndContinue: () => void;
}

export function UnsavedChangesModal({
  open,
  title,
  onCancel,
  onDiscard,
  onSaveAndContinue,
}: UnsavedChangesModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-zinc-950/80"
        onClick={onCancel}
        aria-label="Закрыть окно несохраненных изменений"
      />
      <div className="relative w-full max-w-lg rounded-xl border border-white/[0.08] bg-zinc-900 p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-medium text-zinc-100">Есть несохраненные изменения</h2>
            <p className="mt-1 text-sm text-zinc-400 break-words">
              Текущие правки будут потеряны. Перейти к статье "{title}"?
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100 hover:border-white/[0.16] transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-lg border border-white/[0.12] bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            Перейти без сохранения
          </button>
          <button
            type="button"
            onClick={onSaveAndContinue}
            className="rounded-lg border border-emerald-400/30 bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/30 transition-colors"
          >
            Сохранить и перейти
          </button>
        </div>
      </div>
    </div>
  );
}
