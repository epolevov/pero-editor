# WebSocket API Spec — Pero Text Assistant

## 1. Подключение

```
ws://localhost:8080
```

Без аутентификационных заголовков на уровне WS (MVP). Подключение устанавливается один раз, затем открывается сессия через `post.open`.

---

## 2. Конверт (envelope)

**Каждое сообщение** в обе стороны — JSON одного и того же формата:

```ts
{
  event: string   // имя события
  data:  object   // полезная нагрузка
}
```

Пример (отправка):
```json
{ "event": "post.open", "data": { "workspaceId": "ws_123", "userId": "u_456" } }
```

---

## 3. Client → Server

### `post.open`
Открыть сессию. Вызывается один раз после подключения. При реконнекте — передать `postId`.

```ts
{
  event: "post.open",
  data: {
    workspaceId?: string  // обязателен для новой сессии, min 1
    userId?:      string  // обязателен для новой сессии, min 1
    postId?:      string  // при реконнекте можно передать только postId
  }
}
```

**Ответ сервера:** [`post.snapshot`](#post-snapshot)

**Ошибки:**
| Код | Когда |
|-----|-------|
| `VALIDATION_ERROR` | новая сессия без `workspaceId` / `userId` |
| `POST_NOT_FOUND` (404) | передан `postId`, которого нет в данном workspace |

---

### `post.update`
Отправить новую версию контента. Вызывается после каждого значимого изменения (debounce на фронте рекомендован ≥300ms).

```ts
{
  event: "post.update",
  data: {
    postId:      string                    // обязательный
    contentJson: Record<string, unknown>   // структура документа (ProseMirror JSON и т.п.)
    plainText:   string                    // плоский текст для AI-анализа
    version:     number (int, ≥1)          // ДОЛЖЕН быть currentVersion + 1
  }
}
```

**Ответ сервера:** [`post.ack`](#post-ack)

**Ошибки:**
| Код | Когда |
|-----|-------|
| `VERSION_CONFLICT` (409) | `version ≠ currentVersion + 1` |
| `POST_NOT_FOUND` (404) | неизвестный `postId` |

> **Важно про версии.** Фронтенд сам ведёт счётчик `currentVersion`, стартуя со значения из `post.snapshot`. После каждого успешного `post.ack` — `currentVersion++`. При `VERSION_CONFLICT` — перезапросить snapshot и ресинхронизироваться.

### `post.listByAuthor`
Получить список статей автора (с пагинацией).

```ts
{
  event: "post.listByAuthor",
  data: {
    authorUserId: string
    workspaceId?: string
    limit?: number (int, 1..100, default 20)
    offset?: number (int, ≥0, default 0)
  }
}
```

**Ответ сервера:** [`post.list`](#post-list)

### `post.get`
Получить конкретную статью по `postId`.

```ts
{
  event: "post.get",
  data: {
    postId: string
    workspaceId?: string
  }
}
```

**Ответ сервера:** [`post.detail`](#post-detail)

---

### `suggest.spellcheck`
Запустить проверку орфографии/пунктуации по текущему plainText.

```ts
{
  event: "suggest.spellcheck",
  data: {
    postId:    string
    version:   number (int, ≥0)   // текущая версия документа
    plainText: string (min 1)
  }
}
```

**Ответ сервера:** 0..N сообщений [`suggest.result`](#suggest-result) с `type: "spellcheck"`

---

### `suggest.rewrite`
Переформулировать выделенный фрагмент.

```ts
{
  event: "suggest.rewrite",
  data: {
    postId:       string
    version:      number (int, ≥0)
    selection:    { from: number (int, ≥0), to: number (int, ≥0) }  // символьные позиции
    selectedText: string (min 1)   // текст выделения
    contextText:  string           // окружающий контекст (можно весь документ)
  }
}
```

**Ответ сервера:** 1 сообщение [`suggest.result`](#suggest-result) с `type: "rewrite"`, `replacements[]` содержит ≥2 варианта

---

### `suggest.continue`
Продолжить текст от позиции курсора.

```ts
{
  event: "suggest.continue",
  data: {
    postId:      string
    version:     number (int, ≥0)
    cursorPos:   number (int, ≥0)   // символьная позиция курсора
    intent:      string              // подсказка: "summary" | "example" | "argument" | "conclusion" | любая строка
    contextText: string              // текст до курсора (или весь документ)
  }
}
```

**Ответ сервера:** 1 сообщение [`suggest.result`](#suggest-result) с `type: "continue"`, вставить `insertText` в позицию `cursorPos`

---

### `suggest.apply`
Принять или отклонить подсказку.

```ts
{
  event: "suggest.apply",
  data: {
    postId:       string
    version:      number (int, ≥0)
    suggestionId: string             // id из suggest.result
    action:       "accept" | "reject"
  }
}
```

**Ответ сервера:** [`suggest.removed`](#suggest-removed) (широковещательно всем в той же сессии)

**Ошибки:**
| Код | Когда |
|-----|-------|
| `SUGGESTION_NOT_FOUND` (404) | неизвестный `suggestionId` |
| `SUGGESTION_NOT_PENDING` (409) | уже `accepted` / `rejected` / `stale` |

---

## 4. Server → Client

### `post.snapshot`
Приходит в ответ на `post.open`. Содержит актуальное состояние документа.

```ts
{
  event: "post.snapshot",
  data: {
    postId:      string
    contentJson: Record<string, unknown>   // может быть {} для нового поста
    version:     number                    // стартовый currentVersion для клиента
    workspaceId: string
  }
}
```

---

### `ai.settings.get`
Получить AI-настройки для workspace.

```ts
{
  event: "ai.settings.get",
  data: {
    workspaceId: string
  }
}
```

### `ai.settings.update`
Сохранить AI-настройки для workspace.

```ts
{
  event: "ai.settings.update",
  data: {
    workspaceId: string
    apiKey?: string
    model?: string
  }
}
```

### `ai.settings.clearKey`
Удалить сохранённый API-ключ workspace.

```ts
{
  event: "ai.settings.clearKey",
  data: {
    workspaceId: string
  }
}
```

### `ai.settings`
Ответ на `ai.settings.get/update/clearKey`.

```ts
{
  event: "ai.settings",
  data: {
    workspaceId: string
    hasApiKey: boolean
    model: string | null
  }
}
```

---

### `post.ack`
Подтверждение успешного сохранения версии. Приходит **только** инициатору `post.update`.

```ts
{
  event: "post.ack",
  data: {
    postId:  string
    version: number   // версия, которую сервер принял
  }
}
```

### `post.list`
Ответ на `post.listByAuthor`.

```ts
{
  event: "post.list",
  data: {
    items: Array<{
      name: string            // фрагмент начала статьи
      version: number
      postId: string
      workspaceId: string
      authorUserId: string
      currentVersion: number  // alias version для backward compatibility
      createdAt: string   // ISO datetime
      updatedAt: string   // ISO datetime
    }>
    total: number
    limit: number
    offset: number
  }
}
```

### `post.detail`
Ответ на `post.get`.

```ts
{
  event: "post.detail",
  data: {
    postId: string
    workspaceId: string
    authorUserId: string
    contentJson: Record<string, unknown>
    plainText: string
    version: number
    createdAt: string   // ISO datetime
    updatedAt: string   // ISO datetime
  }
}
```

---

### `suggest.result`
Новая подсказка готова. Приходит **всем** в комнате поста.

```ts
{
  event: "suggest.result",
  data: {
    postId:  string
    version: number   // версия документа, к которой привязана подсказка
    suggestion: {
      id:           string
      type:         "spellcheck" | "rewrite" | "continue"
      range:        { from: number, to: number }   // позиции в документе
      title:        string        // короткий заголовок для UI
      message:      string        // описание для пользователя
      replacements: string[]      // варианты замены (для spellcheck/rewrite)
      diff?:        string        // unified-diff строка (может отсутствовать)
      insertText?:  string        // текст вставки (только для type: "continue")
      confidence:   number        // 0..1, уверенность модели
    }
  }
}
```

### `suggest.loading`
Состояние выполнения AI-запроса. Приходит всем клиентам в комнате поста.

```ts
{
  event: "suggest.loading",
  data: {
    postId: string
    version: number
    type: "spellcheck" | "rewrite" | "continue"
    status: "start" | "done" | "error"
    message?: string   // присутствует при status = "error"
  }
}
```

**Что делать по `type`:**

| `type` | Что показать | Что вставить |
|--------|-------------|--------------|
| `spellcheck` | подсветить `range`, предложить `replacements[0]` | заменить `range` на выбранный `replacements[i]` |
| `rewrite` | показать список `replacements` | заменить `range` на выбранный вариант |
| `continue` | показать превью `insertText` | вставить `insertText` в позицию `range.from` |

---

### `suggest.removed`
Подсказка больше не актуальна (принята/отклонена/устарела после новой версии документа). Приходит **всем** в комнате.

```ts
{
  event: "suggest.removed",
  data: {
    postId:       string
    suggestionId: string
  }
}
```

Фронт должен удалить подсказку с `id === suggestionId` из локального состояния.

---

### `error`
Ошибка в ответ на любое клиентское сообщение.

```ts
{
  event: "error",
  data: {
    message: string    // читаемое описание
    event?:  string    // событие, которое вызвало ошибку
  }
}
```

---

## 5. Жизненный цикл сессии

```
WS connect
    │
    ▼
post.open ─────────────────────────────────── reconnect: post.open { postId }
    │                                                          │
    ▼                                                          ▼
post.snapshot { postId, contentJson, version }   post.snapshot (актуальный снимок)
    │
    ▼  (пользователь редактирует)
post.update { postId, contentJson, plainText, version: N+1 }
    │
    ├──→ post.ack { version: N+1 }           ← только отправителю
    └──→ suggest.removed { ... }×K           ← всем в комнате (устаревшие)
    │
    ▼  (запрос подсказок — независимо от update)
suggest.spellcheck / suggest.rewrite / suggest.continue
    │
    ▼
suggest.result { suggestion } ×1..N          ← всем в комнате
    │
    ▼  (пользователь выбирает подсказку)
suggest.apply { suggestionId, action }
    │
    ▼
suggest.removed { suggestionId }             ← всем в комнате
```

---

## 6. Управление версиями на фронте

```ts
let currentVersion = snapshot.version  // из post.snapshot

// При каждой отправке:
function sendUpdate(contentJson, plainText) {
  const proposedVersion = currentVersion + 1
  ws.send(JSON.stringify({
    event: 'post.update',
    data: { postId, contentJson, plainText, version: proposedVersion }
  }))
}

// При получении post.ack:
ws.on('message', (raw) => {
  const { event, data } = JSON.parse(raw)
  if (event === 'post.ack') {
    currentVersion = data.version   // подтверждаем
  }
  if (event === 'error' && data.event === 'post.update') {
    // VERSION_CONFLICT — нужна ресинхронизация
    // Переоткрыть через post.open { postId } чтобы получить свежий snapshot
  }
})
```

---

## 7. TypeScript-типы для фронта (copy-paste)

```ts
// ─── Envelope ───────────────────────────────────────────────────────────────

export interface WsEnvelope<T = unknown> {
  event: string;
  data: T;
}

// ─── Client → Server ────────────────────────────────────────────────────────

export interface PostOpenData      { workspaceId?: string; userId?: string; postId?: string }
export interface PostUpdateData    { postId: string; contentJson: Record<string, unknown>; plainText: string; version: number }
export interface SuggestSpellcheckData { postId: string; version: number; plainText: string }
export interface SuggestRewriteData    { postId: string; version: number; selection: { from: number; to: number }; selectedText: string; contextText: string }
export interface SuggestContinueData   { postId: string; version: number; cursorPos: number; intent: string; contextText: string }
export interface SuggestApplyData      { postId: string; version: number; suggestionId: string; action: 'accept' | 'reject' }

// ─── Server → Client ────────────────────────────────────────────────────────

export interface PostSnapshotData  { postId: string; contentJson: Record<string, unknown>; version: number }
export interface PostAckData       { postId: string; version: number }

export interface SuggestionResult {
  id: string;
  type: 'spellcheck' | 'rewrite' | 'continue';
  range: { from: number; to: number };
  title: string;
  message: string;
  replacements: string[];
  diff?: string;
  insertText?: string;
  confidence: number;
}
export interface SuggestResultData  { postId: string; version: number; suggestion: SuggestionResult }
export interface SuggestRemovedData { postId: string; suggestionId: string }
export interface ErrorData          { message: string; event?: string }
```

---

## 8. Валидационные правила (что сервер отклонит)

| Поле | Правило |
|------|---------|
| `workspaceId`, `userId`, `postId`, `suggestionId` | `string`, длина ≥ 1 |
| `version` в `post.update` | `int ≥ 1`, обязательно `=== currentVersion + 1` |
| `version` в suggest-* | `int ≥ 0` |
| `selection.from`, `selection.to` | `int ≥ 0` |
| `cursorPos` | `int ≥ 0` |
| `action` | строго `"accept"` или `"reject"` |
| `selectedText`, `plainText` | `string`, длина ≥ 1 |
| `contextText`, `intent` | `string`, может быть пустым |
| `contentJson` | любой JSON-объект |
