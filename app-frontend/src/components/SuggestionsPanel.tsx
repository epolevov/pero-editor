import { ArrowRight, BarChart2, RefreshCw, SpellCheck, Sparkles, Zap } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import type { AuditSegment, SuggestionResult } from '../lib/wsProtocol';

const TYPE_LABEL: Record<string, string> = {
  spellcheck: 'Орфография',
  rewrite: 'Переписать',
  continue: 'Продолжить',
  hooks: 'Зацепки',
  audit: 'Аудит',
};

const HEALTH_BADGE: Record<string, { label: string; className: string }> = {
  Weak: { label: 'Слабая', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  Fair: { label: 'Средняя', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  Good: { label: 'Хорошая', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
  Strong: { label: 'Сильная', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
};

function AuditSegmentCard({ segment }: { segment: AuditSegment }) {
  const scoreColor =
    segment.score <= 3 ? 'text-red-400 border-red-500/30 bg-red-500/10' :
    segment.score <= 4 ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' :
    'text-yellow-400 border-yellow-500/30 bg-yellow-500/10';

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${scoreColor}`}>
          {segment.id} · {segment.score}/10
        </span>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">{segment.technique}</span>
      </div>
      <p className="text-xs text-zinc-500 line-clamp-2 italic">«{segment.original}»</p>
      <p className="text-xs text-zinc-400">{segment.problem}</p>
      <div className="px-2 py-1.5 rounded-lg bg-emerald-500/[0.06] border-l-2 border-emerald-500/30">
        <span className="block text-[10px] text-emerald-400/60 uppercase tracking-wider mb-0.5 font-medium">Предложение</span>
        <p className="text-xs text-zinc-300">{segment.edit}</p>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
  );
}

function RewriteVariants({
  suggestion,
  onSelectVariant,
}: {
  suggestion: SuggestionResult;
  onSelectVariant: (index: number) => void;
}) {
  const { replacements = [], styles = [], selectedVariantIndex = 0, originalText } = suggestion;
  const hasMultiple = replacements.length > 1;

  return (
    <div className="flex flex-col gap-1.5">
      {originalText && (
        <div className="px-2.5 py-2 rounded-lg bg-red-500/[0.06] border-l-2 border-red-500/30">
          <span className="block text-[10px] text-red-400/60 uppercase tracking-wider mb-1 font-medium">Было</span>
          <p className="text-sm text-zinc-500 line-clamp-2">{originalText}</p>
        </div>
      )}
      {hasMultiple ? (
        <div className="flex flex-col gap-1">
          {replacements.map((text, i) => {
            const isSelected = selectedVariantIndex === i;
            const styleLabel = styles[i];
            return (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); onSelectVariant(i); }}
                className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                  isSelected
                    ? 'bg-emerald-500/[0.08] border-emerald-500/30'
                    : 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04]'
                }`}
              >
                {styleLabel && (
                  <span className={`block text-[10px] uppercase tracking-wider mb-1 font-medium ${
                    isSelected ? 'text-emerald-400/70' : 'text-zinc-600'
                  }`}>
                    {styleLabel}
                  </span>
                )}
                <p className={`text-sm line-clamp-2 ${isSelected ? 'text-zinc-200' : 'text-zinc-400'}`}>{text}</p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="px-2.5 py-2 rounded-lg bg-emerald-500/[0.06] border-l-2 border-emerald-500/30">
          <span className="block text-[10px] text-emerald-400/60 uppercase tracking-wider mb-1 font-medium">Стало</span>
          <p className="text-sm text-zinc-300 line-clamp-3">{replacements[0]}</p>
        </div>
      )}
    </div>
  );
}

interface SuggestionsPanelProps {
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onSpellcheck?: () => void;
  onRewrite?: () => void;
  onContinue?: () => void;
  onHooks?: () => void;
  onAudit?: () => void;
  onOpenAiSettings?: () => void;
}

export function SuggestionsPanel({
  onAccept,
  onReject,
  onSpellcheck,
  onRewrite,
  onContinue,
  onHooks,
  onAudit,
  onOpenAiSettings,
}: SuggestionsPanelProps) {
  const {
    suggestions,
    activeSuggestionId,
    setActiveSuggestionId,
    aiLoadingByType,
    clearAllSuggestions,
    currentWorkspaceId,
    aiSettings,
    setSelectedVariant,
  } = useEditorStore();

  const suggestionsList = Array.from(suggestions.values());
  const hasAnyLoading = Object.values(aiLoadingByType).some((status) => status === 'loading');

  return (
    <div className="h-full border border-white/[0.06] rounded-xl bg-zinc-950 p-4 flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Подсказки</h3>
        <div className="flex items-center gap-2">
          {hasAnyLoading && (
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <Spinner />
              <span>AI работает...</span>
            </div>
          )}
          {suggestionsList.length > 0 && (
            <button
              onClick={clearAllSuggestions}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Очистить
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1 space-y-2">
        {suggestionsList.length === 0 ? (
          <div className="flex flex-col gap-5 px-1 py-4">
            <div className="text-center">
              <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-white/[0.06] flex items-center justify-center mx-auto mb-3">
                <Sparkles className="h-4 w-4 text-zinc-500" />
              </div>
              <p className="text-sm text-zinc-400 font-medium mb-1">AI-помощник</p>
              <p className="text-xs text-zinc-600">Нажмите Tab в редакторе, чтобы начать</p>
            </div>

            {currentWorkspaceId && aiSettings.workspaceId === currentWorkspaceId && !aiSettings.hasApiKey && (
              <div className="rounded-lg border border-amber-300/20 bg-amber-500/10 p-3">
                <p className="text-xs text-amber-200">
                  Для AI-действий нужен OpenRouter API-ключ текущего рабочего пространства.
                </p>
                <button
                  type="button"
                  onClick={onOpenAiSettings}
                  className="mt-2 rounded-md border border-amber-300/30 px-2.5 py-1 text-xs text-amber-100 hover:bg-amber-500/15 transition-colors"
                >
                  Открыть настройки ИИ
                </button>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {([
                {
                  icon: SpellCheck,
                  label: 'Орфография',
                  description: 'Проверит весь текст на ошибки',
                  trigger: 'tab → Орфография',
                  onClick: onSpellcheck,
                },
                {
                  icon: RefreshCw,
                  label: 'Переписать',
                  description: 'Выделите нужный фрагмент',
                  trigger: 'tab → Переписать',
                  onClick: onRewrite,
                },
                {
                  icon: ArrowRight,
                  label: 'Продолжить',
                  description: 'Поставьте курсор, выберите стиль',
                  trigger: 'tab → Продолжить',
                  onClick: onContinue,
                },
                {
                  icon: Zap,
                  label: 'Зацепки',
                  description: 'Генерирует 3 крючка для начала статьи',
                  trigger: 'tab → Зацепки',
                  onClick: onHooks,
                },
                {
                  icon: BarChart2,
                  label: 'Аудит',
                  description: 'Находит слабые сегменты и предлагает правки',
                  trigger: 'tab → Аудит',
                  onClick: onAudit,
                },
              ] as const).map(({ icon: Icon, label, description, trigger, onClick }) => (
                <button
                  key={label}
                  onClick={onClick}
                  className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.12] transition-colors text-left w-full cursor-pointer"
                >
                  <div className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-md bg-zinc-800 flex items-center justify-center">
                    <Icon className="h-3.5 w-3.5 text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span className="text-sm text-zinc-300 font-medium">{label}</span>
                      <span className="text-[11px] text-zinc-600 flex-shrink-0">{trigger}</span>
                    </div>
                    <p className="text-xs text-zinc-500">{description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          suggestionsList.map((s) => {
            const isActive = activeSuggestionId === s.id;
            return (
              <div
                key={s.id}
                onClick={() => setActiveSuggestionId(s.id)}
                className={`group p-3 rounded-lg border cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-emerald-500/10 border-emerald-500/20'
                    : 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-emerald-500 uppercase tracking-wider">
                    {TYPE_LABEL[s.type] ?? s.type}
                  </span>
                </div>

                {s.title && <p className="text-sm text-zinc-200 mb-1">{s.title}</p>}
                {s.message && <p className="text-xs text-zinc-500 mb-2">{s.message}</p>}

                {s.type === 'continue' && s.insertText && (
                  <p className="text-sm text-zinc-300 line-clamp-3">{s.insertText}</p>
                )}

                {s.type === 'rewrite' && s.replacements && (
                  <RewriteVariants
                    suggestion={s}
                    onSelectVariant={(index) => setSelectedVariant(s.id, index)}
                  />
                )}

                {s.type === 'spellcheck' && s.replacements && (
                  <div className="flex flex-col gap-1.5">
                    {s.replacements.map((r, i) => (
                      <div key={i} className="text-sm text-zinc-300 bg-zinc-900 p-2 rounded-lg border border-white/[0.06]">
                        {r}
                      </div>
                    ))}
                  </div>
                )}

                {s.type === 'hooks' && s.replacements && (
                  <div className="flex flex-col gap-1.5">
                    <RewriteVariants
                      suggestion={s}
                      onSelectVariant={(index) => setSelectedVariant(s.id, index)}
                    />
                    {s.diff && (
                      <div className="px-2.5 py-1.5 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20">
                        <span className="block text-[10px] text-emerald-400/60 uppercase tracking-wider mb-0.5 font-medium">Рекомендация</span>
                        <p className="text-xs text-emerald-300/80">{s.diff}</p>
                      </div>
                    )}
                  </div>
                )}

                {s.type === 'audit' && (
                  <div className="flex flex-col gap-2">
                    {s.health && (
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${HEALTH_BADGE[s.health]?.className ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
                          {HEALTH_BADGE[s.health]?.label ?? s.health}
                        </span>
                        {s.totalSegments != null && (
                          <span className="text-xs text-zinc-500">{s.totalSegments} сегментов</span>
                        )}
                      </div>
                    )}
                    {s.segments && s.segments.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {s.segments.map((seg) => (
                          <AuditSegmentCard key={seg.id} segment={seg} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500">Слабых сегментов не обнаружено.</p>
                    )}
                    {s.editorNote && (
                      <div className="px-2.5 py-2 rounded-lg bg-zinc-900 border border-white/[0.06]">
                        <span className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium">Редакторская заметка</span>
                        <p className="text-xs text-zinc-400">{s.editorNote}</p>
                      </div>
                    )}
                  </div>
                )}

                {s.type !== 'audit' && (
                  <div
                    className={`mt-3 flex gap-2 transition-opacity ${
                      isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); onAccept(s.id); }}
                      className="flex-1 py-1.5 text-xs rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                    >
                      Принять
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onReject(s.id); }}
                      className="flex-1 py-1.5 text-xs rounded-lg bg-white/[0.04] text-zinc-400 border border-white/[0.06] hover:bg-white/[0.08] hover:text-zinc-300 transition-colors"
                    >
                      Отклонить
                    </button>
                  </div>
                )}
                {s.type === 'audit' && (
                  <div
                    className={`mt-3 flex gap-2 transition-opacity ${
                      isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); onReject(s.id); }}
                      className="flex-1 py-1.5 text-xs rounded-lg bg-white/[0.04] text-zinc-400 border border-white/[0.06] hover:bg-white/[0.08] hover:text-zinc-300 transition-colors"
                    >
                      Закрыть
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
