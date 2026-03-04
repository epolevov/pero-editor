import {
  AiSettingsData,
  AiSettingsClearKeyData,
  AiSettingsGetData,
  AiSettingsUpdateData,
  PostDetailData,
  PostGetRequestData,
  PostListByAuthorRequestData,
  PostListData,
  WSEnvelope,
} from './wsProtocol';

type SendTransport = (msg: WSEnvelope) => void;

const REQUEST_TIMEOUT_MS = 10000;

let sendTransport: SendTransport | null = null;

let activeListRequest:
  | {
      promise: Promise<PostListData>;
      resolve: (data: PostListData) => void;
      reject: (reason?: unknown) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  | null = null;

const detailWaiters = new Map<
  string,
  {
    promise: Promise<PostDetailData>;
    resolve: (data: PostDetailData) => void;
    reject: (reason?: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

const aiSettingsWaiters = new Map<
  string,
  {
    workspaceId: string;
    promise: Promise<AiSettingsData>;
    resolve: (data: AiSettingsData) => void;
    reject: (reason?: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

function ensureTransport(): SendTransport {
  if (!sendTransport) {
    throw new Error('WebSocket transport is not ready');
  }
  return sendTransport;
}

function clearListRequest() {
  if (activeListRequest) {
    clearTimeout(activeListRequest.timeout);
  }
  activeListRequest = null;
}

export function setWsApiTransport(sender: SendTransport | null) {
  sendTransport = sender;
  if (!sender) {
    rejectAllPending('WS transport disconnected');
  }
}

export function rejectAllPending(reason: string) {
  if (activeListRequest) {
    activeListRequest.reject(new Error(reason));
    clearListRequest();
  }

  for (const [postId, entry] of detailWaiters.entries()) {
    clearTimeout(entry.timeout);
    entry.reject(new Error(reason));
    detailWaiters.delete(postId);
  }

  for (const [key, entry] of aiSettingsWaiters.entries()) {
    clearTimeout(entry.timeout);
    entry.reject(new Error(reason));
    aiSettingsWaiters.delete(key);
  }
}

function requestAiSettings(
  event: 'ai.settings.get' | 'ai.settings.update' | 'ai.settings.clearKey',
  payload: AiSettingsGetData | AiSettingsUpdateData | AiSettingsClearKeyData,
): Promise<AiSettingsData> {
  const sender = ensureTransport();
  const key = `${event}:${payload.workspaceId}:${Date.now()}:${Math.random()}`;

  let resolveFn: (data: AiSettingsData) => void = () => {};
  let rejectFn: (reason?: unknown) => void = () => {};

  const promise = new Promise<AiSettingsData>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const timeout = setTimeout(() => {
    const pending = aiSettingsWaiters.get(key);
    if (!pending) return;
    aiSettingsWaiters.delete(key);
    pending.reject(new Error(`${event} timeout for ${payload.workspaceId}`));
  }, REQUEST_TIMEOUT_MS);

  aiSettingsWaiters.set(key, {
    workspaceId: payload.workspaceId,
    promise,
    resolve: resolveFn,
    reject: rejectFn,
    timeout,
  });

  sender({
    event,
    data: payload,
  });

  return promise;
}

export function requestAiSettingsGet(payload: AiSettingsGetData): Promise<AiSettingsData> {
  return requestAiSettings('ai.settings.get', payload);
}

export function requestAiSettingsUpdate(payload: AiSettingsUpdateData): Promise<AiSettingsData> {
  return requestAiSettings('ai.settings.update', payload);
}

export function requestAiSettingsClearKey(payload: AiSettingsClearKeyData): Promise<AiSettingsData> {
  return requestAiSettings('ai.settings.clearKey', payload);
}

export function requestPostListByAuthor(
  payload: PostListByAuthorRequestData,
): Promise<PostListData> {
  if (activeListRequest) {
    return activeListRequest.promise;
  }

  const sender = ensureTransport();

  let resolveFn: (data: PostListData) => void = () => {};
  let rejectFn: (reason?: unknown) => void = () => {};

  const promise = new Promise<PostListData>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const timeout = setTimeout(() => {
    if (!activeListRequest) return;
    activeListRequest.reject(new Error('post.list timeout'));
    clearListRequest();
  }, REQUEST_TIMEOUT_MS);

  activeListRequest = {
    promise,
    resolve: resolveFn,
    reject: rejectFn,
    timeout,
  };

  sender({
    event: 'post.listByAuthor',
    data: payload,
  });

  return promise;
}

export function requestPostDetail(payload: PostGetRequestData): Promise<PostDetailData> {
  const existing = detailWaiters.get(payload.postId);
  if (existing) {
    return existing.promise;
  }

  const sender = ensureTransport();

  let resolveFn: (data: PostDetailData) => void = () => {};
  let rejectFn: (reason?: unknown) => void = () => {};

  const promise = new Promise<PostDetailData>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const timeout = setTimeout(() => {
    const pending = detailWaiters.get(payload.postId);
    if (!pending) return;
    detailWaiters.delete(payload.postId);
    pending.reject(new Error(`post.detail timeout for ${payload.postId}`));
  }, REQUEST_TIMEOUT_MS);

  detailWaiters.set(payload.postId, {
    promise,
    resolve: resolveFn,
    reject: rejectFn,
    timeout,
  });

  sender({
    event: 'post.get',
    data: payload,
  });

  return promise;
}

export function resolveWsEvent(msg: WSEnvelope) {
  if (msg.event === 'post.list') {
    const data = msg.data as PostListData;
    if (!activeListRequest) return;

    const pending = activeListRequest;
    clearListRequest();
    pending.resolve(data);
    return;
  }

  if (msg.event === 'post.detail') {
    const data = msg.data as PostDetailData;
    const pending = detailWaiters.get(data.postId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    detailWaiters.delete(data.postId);
    pending.resolve(data);
    return;
  }

  if (msg.event === 'ai.settings') {
    const data = msg.data as AiSettingsData;
    for (const [key, pending] of aiSettingsWaiters.entries()) {
      if (pending.workspaceId !== data.workspaceId) {
        continue;
      }
      clearTimeout(pending.timeout);
      aiSettingsWaiters.delete(key);
      pending.resolve(data);
    }
  }
}
