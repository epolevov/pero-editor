import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';

export function ToastStack() {
  const { toasts, dismissToast } = useEditorStore();

  useEffect(() => {
    if (toasts.length === 0) return;

    const timers = toasts.map((toast) =>
      setTimeout(() => {
        dismissToast(toast.id);
      }, 4000),
    );

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [toasts, dismissToast]);

  return (
    <div className="fixed right-4 bottom-4 z-[80] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="min-w-72 max-w-sm rounded-lg border border-white/[0.06] bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
        >
          <div className="flex items-start justify-between gap-3">
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="text-xs text-zinc-500 hover:text-zinc-200"
            >
              Закрыть
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
