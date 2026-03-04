import { useEffect, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';

interface HotkeysHelpProps {
  grouped?: boolean;
}

export function HotkeysHelp({ grouped = false }: HotkeysHelpProps) {
  const [isMac, setIsMac] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const modifierKeyLabel = isMac ? 'Cmd' : 'Ctrl';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const platform = window.navigator.platform || '';
    const userAgent = window.navigator.userAgent || '';
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS/i.test(userAgent));
  }, []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Показать горячие клавиши"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex h-8 w-8 items-center justify-center text-zinc-300 transition-all duration-150 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
          grouped
            ? 'rounded-lg border border-white/[0.06] hover:border-white/[0.12]'
            : 'rounded-lg border border-white/[0.06] bg-zinc-900'
        }`}
      >
        <CircleHelp className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-96 rounded-xl border border-white/[0.06] bg-zinc-900 p-3 text-xs text-zinc-300">
          <div className="mb-2 text-zinc-100">Горячие клавиши</div>
          <div className="space-y-1.5">
            <div><kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">{modifierKeyLabel}+Shift+E</kbd> Проверка орфографии (если есть текст)</div>
            <div><kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">{modifierKeyLabel}+Shift+R</kbd> Переписать выделенный текст</div>
            <div><kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">{modifierKeyLabel}+Shift+→</kbd> Продолжить текст</div>
            <div><kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">{modifierKeyLabel}+Enter</kbd> Принять активную подсказку</div>
            <div><kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">Esc</kbd> Отклонить подсказку / закрыть меню</div>
          </div>
        </div>
      )}
    </div>
  );
}
