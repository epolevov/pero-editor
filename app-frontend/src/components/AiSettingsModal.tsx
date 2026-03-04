import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Settings } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';

interface AiSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function AiSettingsModal({ open, onClose }: AiSettingsModalProps) {
  const { aiSettings, currentWorkspaceId, saveAiSettings, clearAiKey, loadAiSettings } = useEditorStore();
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const workspaceId = currentWorkspaceId || aiSettings.workspaceId;

  useEffect(() => {
    if (!open) return;

    setApiKey('');
    setModel(aiSettings.model || '');
    setLocalError(null);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, aiSettings.model]);

  const keyStatusText = useMemo(() => {
    if (aiSettings.loading) return 'Проверяем настройки...';
    return aiSettings.hasApiKey
      ? 'Все корректно настроено: ключ OpenRouter сохранен.'
      : 'Ключ не сохранен';
  }, [aiSettings.hasApiKey, aiSettings.loading]);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    if (!workspaceId) {
      setLocalError('Рабочее пространство не найдено. Откройте документ и попробуйте снова.');
      return;
    }

    const normalizedModel = model.trim();
    const normalizedApiKey = apiKey.trim();

    if (!normalizedModel && !normalizedApiKey) {
      setLocalError('Укажите модель или API-ключ для сохранения.');
      return;
    }

    const success = await saveAiSettings({
      workspaceId,
      apiKey: normalizedApiKey || undefined,
      model: normalizedModel || undefined,
    });

    if (success) {
      setApiKey('');
    }
  };

  const handleReload = async () => {
    setLocalError(null);
    if (!workspaceId) {
      setLocalError('Рабочее пространство не найдено.');
      return;
    }
    await loadAiSettings(workspaceId);
  };

  const handleClearKey = async () => {
    setLocalError(null);
    if (!workspaceId) {
      setLocalError('Рабочее пространство не найдено.');
      return;
    }
    await clearAiKey(workspaceId);
    setApiKey('');
  };

  const error = localError || aiSettings.error;

  return (
    <div className="fixed inset-0 z-[96] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-zinc-950/80"
        onClick={onClose}
        aria-label="Закрыть настройки ИИ"
      />
      <div className="relative w-full max-w-lg rounded-xl border border-white/[0.08] bg-zinc-900 p-5 shadow-2xl">
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08] bg-zinc-950 text-zinc-400 transition-colors hover:border-white/[0.16] hover:text-zinc-200"
              aria-label="Закрыть модальное окно"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="flex items-center gap-1.5 text-base font-medium text-zinc-100">
              <Settings className="h-4 w-4 text-zinc-400" />
              Настройки ИИ
            </h2>
          </div>
          <p className="mt-2 text-sm text-zinc-400">Рабочее пространство: {workspaceId || 'не выбрано'}</p>
          <p className={`mt-1 text-xs ${aiSettings.hasApiKey ? 'text-emerald-300' : 'text-zinc-500'}`}>
            {keyStatusText}
          </p>
        </div>

        <form className="space-y-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-zinc-400">OpenRouter API-ключ</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="or-..."
              className="rounded-lg border border-white/[0.08] bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-emerald-500/40"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-zinc-400">Модель</span>
            <input
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="google/gemini-2.0-flash-001"
              className="rounded-lg border border-white/[0.08] bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-emerald-500/40"
            />
          </label>

          {error && <p className="text-xs text-red-300">{error}</p>}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleReload}
              disabled={aiSettings.loading}
              className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100 hover:border-white/[0.16] disabled:opacity-50 transition-colors"
            >
              Обновить
            </button>
            <button
              type="button"
              onClick={handleClearKey}
              disabled={aiSettings.loading || !workspaceId}
              className="rounded-lg border border-red-300/30 bg-red-500/15 px-3 py-1.5 text-sm text-red-200 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
            >
              Очистить ключ
            </button>
            <button
              type="submit"
              disabled={aiSettings.loading || !workspaceId}
              className="rounded-lg border border-emerald-400/30 bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
            >
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
