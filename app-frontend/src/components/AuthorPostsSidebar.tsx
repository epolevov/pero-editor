import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { AuthorPostListItem } from '../lib/wsProtocol';

interface AuthorPostsSidebarProps {
  mobile?: boolean;
  onSelectPost?: (post: AuthorPostListItem) => void;
  onRequestDelete?: (post: AuthorPostListItem) => void;
  onCreatePost?: () => void;
}

const defaultWorkspaceId = import.meta.env.VITE_WORKSPACE_ID || 'default-workspace';
const defaultAuthorUserId = import.meta.env.VITE_AUTHOR_USER_ID || 'default-user';

function SidebarSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 7 }).map((_, index) => (
        <div
          key={index}
          className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2"
        >
          <div className="h-4 w-3/4 rounded bg-white/[0.04] border border-white/[0.06]" />
          <div className="h-4 w-full rounded bg-white/[0.04] border border-white/[0.06]" />
          <div className="h-4 w-1/2 rounded bg-white/[0.04] border border-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getPostDisplayName(item: AuthorPostListItem) {
  return item.name?.trim() || item.title?.trim() || 'Без названия';
}

export function AuthorPostsSidebar({
  mobile = false,
  onSelectPost,
  onRequestDelete,
  onCreatePost,
}: AuthorPostsSidebarProps) {
  const {
    authorPosts,
    currentPost,
    currentPostLoading,
    pendingDeletePostIds,
    loadAuthorPosts,
  } = useEditorStore();

  const hasPrev = authorPosts.offset > 0;
  const hasNext = authorPosts.offset + authorPosts.limit < authorPosts.total;

  const pagingLabel = useMemo(() => {
    if (authorPosts.total === 0) return '0 / 0';
    const from = authorPosts.offset + 1;
    const to = Math.min(authorPosts.offset + authorPosts.limit, authorPosts.total);
    return `${from}-${to} / ${authorPosts.total}`;
  }, [authorPosts.offset, authorPosts.limit, authorPosts.total]);

  const reload = (nextOffset: number) => {
    void loadAuthorPosts({
      authorUserId: defaultAuthorUserId,
      workspaceId: defaultWorkspaceId,
      limit: authorPosts.limit,
      offset: Math.max(0, nextOffset),
    });
  };

  return (
    <aside
      className={`h-full border border-white/[0.06] rounded-xl bg-zinc-950 p-4 flex flex-col ${
        mobile ? 'w-full' : 'w-[320px]'
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-zinc-100">Статьи</h2>
        <button
          type="button"
          onClick={onCreatePost}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 hover:border-white/[0.16] hover:text-zinc-100 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Новая
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-1 space-y-2">
        {authorPosts.isLoading ? (
          <SidebarSkeleton />
        ) : authorPosts.items.length === 0 ? (
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-zinc-500">
            Нет статей
          </div>
        ) : (
          authorPosts.items.map((item) => {
            const isActive = currentPost.postId === item.postId;
            const isDeletePending = pendingDeletePostIds.has(item.postId);
            const handleSelectPost = () => {
              onSelectPost?.(item);
            };
            const deleteButtonVisibilityClass = mobile
              ? 'opacity-100'
              : 'opacity-0 pointer-events-none scale-75 rotate-6 group-hover:opacity-100 group-hover:pointer-events-auto group-hover:scale-100 group-hover:rotate-0 group-focus-within:opacity-100 group-focus-within:pointer-events-auto group-focus-within:scale-100 group-focus-within:rotate-0';
            return (
              <div
                key={item.postId}
                role="button"
                tabIndex={0}
                onClick={handleSelectPost}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectPost();
                  }
                }}
                className={`group w-full text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-emerald-500/10 border-emerald-500/20'
                    : 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.14]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 text-left">
                    <div className="text-sm text-zinc-100 line-clamp-1">
                      {getPostDisplayName(item)}
                    </div>
                    {item.previewText && (
                      <div className="mt-1 text-xs text-zinc-500 line-clamp-2">{item.previewText}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRequestDelete?.(item);
                    }}
                    disabled={isDeletePending}
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.08] text-zinc-400 hover:text-red-300 hover:border-red-300/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 ease-out ${deleteButtonVisibilityClass}`}
                    aria-label="Удалить статью"
                    title="Удалить статью"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>{formatDate(item.updatedAt)}</span>
                  <span>v{item.version ?? '—'}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-white/[0.06]">
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
          <button
            type="button"
            disabled={!hasPrev || authorPosts.isLoading}
            className="px-3 py-1.5 rounded-lg border border-white/[0.06] disabled:opacity-40"
            onClick={() => reload(authorPosts.offset - authorPosts.limit)}
          >
            Назад
          </button>
          <span>{pagingLabel}</span>
          <button
            type="button"
            disabled={!hasNext || authorPosts.isLoading}
            className="px-3 py-1.5 rounded-lg border border-white/[0.06] disabled:opacity-40"
            onClick={() => reload(authorPosts.offset + authorPosts.limit)}
          >
            Вперёд
          </button>
        </div>
        {currentPostLoading && (
          <div className="mt-2 text-xs text-zinc-500">Загрузка статьи...</div>
        )}
        {authorPosts.error && (
          <div className="mt-2 text-xs text-red-300">{authorPosts.error}</div>
        )}
      </div>
    </aside>
  );
}
