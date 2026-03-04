import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDeleteModalProps {
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteModal({
  open,
  title,
  onCancel,
  onConfirm,
}: ConfirmDeleteModalProps) {
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
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-zinc-950/80"
        onClick={onCancel}
        aria-label="Закрыть подтверждение удаления"
      />
      <div className="relative w-full max-w-md rounded-xl border border-white/[0.08] bg-zinc-900 p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-medium text-zinc-100">Удалить статью?</h2>
            <p className="mt-1 text-sm text-zinc-400 break-words">
              Действие необратимо. Статья "{title}" будет удалена для всех участников.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100 hover:border-white/[0.16] transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg border border-red-300/30 bg-red-500/20 px-3 py-1.5 text-sm text-red-200 hover:bg-red-500/30 transition-colors"
          >
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}
