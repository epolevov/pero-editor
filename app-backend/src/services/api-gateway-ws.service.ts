import { Context, Service, ServiceBroker } from 'moleculer';
import { WebSocketServer, WebSocket } from 'ws';
import {
  validate,
  PostOpenSchema,
  PostUpdateSchema,
  PostListByAuthorSchema,
  PostGetSchema,
  PostDeleteSchema,
  SuggestSpellcheckSchema,
  SuggestRewriteSchema,
  SuggestContinueSchema,
  SuggestApplySchema,
  AiSettingsGetSchema,
  AiSettingsUpdateSchema,
  AiSettingsClearKeySchema,
} from '../validators/ws-messages';
import type {
  PostUpdatedEvent,
  PostDeletedEvent,
  SuggestionReadyEvent,
  SuggestionRemovedEvent,
  WsEnvelope,
  PostSnapshotMessage,
  PostListMessage,
  PostDetailMessage,
  PostAckMessage,
  SuggestResultMessage,
  SuggestRemovedMessage,
  SuggestLoadingMessage,
  AiSettingsMessage,
} from '../types';

interface ClientMeta {
  postId?: string;
  userId?: string;
  workspaceId?: string;
}

/**
 * api-gateway-ws.service
 *
 * Single WebSocket entry-point.  Responsibilities:
 *   1. Accept WS connections and track which post each socket is viewing.
 *   2. Parse + validate incoming messages (via Zod) and call Moleculer actions.
 *   3. Subscribe to internal events and push the correct WS messages to rooms.
 *
 * "Room" = Set<WebSocket> keyed by postId.  No external pub/sub is needed
 * for a single-node deployment; swap to Redis Pub/Sub adapter if you scale out.
 */
export default class ApiGatewayWsService extends Service {
  private wss!: WebSocketServer;

  /** postId → connected sockets */
  private rooms = new Map<string, Set<WebSocket>>();

  /** socket → current client metadata */
  private clientMeta = new Map<WebSocket, ClientMeta>();

  public constructor(broker: ServiceBroker) {
    super(broker);

    this.parseServiceSchema({
      name: 'api-gateway-ws',

      events: {
        'post.updated': {
          handler: (ctx: Context<PostUpdatedEvent>) =>
            this.onPostUpdated(ctx.params),
        },
        'post.deleted': {
          handler: (ctx: Context<PostDeletedEvent>) =>
            this.onPostDeleted(ctx.params),
        },
        'suggestion.ready': {
          handler: (ctx: Context<SuggestionReadyEvent>) =>
            this.onSuggestionReady(ctx.params),
        },
        'suggestion.removed': {
          handler: (ctx: Context<SuggestionRemovedEvent>) =>
            this.onSuggestionRemoved(ctx.params),
        },
      },

      started: () => this.startWss(),
      stopped: () => this.stopWss(),
    });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  private startWss(): Promise<void> {
    const port = parseInt(process.env.WS_PORT || '8080', 10);

    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port });

      this.wss.on('connection', (ws: WebSocket) => {
        this.clientMeta.set(ws, {});

        ws.on('message', (raw: Buffer) => void this.handleMessage(ws, raw));
        ws.on('close', () => this.handleDisconnect(ws));
        ws.on('error', (err) =>
          this.logger.error('WS socket error:', err.message),
        );
      });

      this.wss.on('listening', () => {
        this.logger.info(`WebSocket server listening on ws://0.0.0.0:${port}`);
        resolve();
      });

      this.wss.on('error', (err) => {
        this.logger.error('WebSocket server error:', err.message);
      });
    });
  }

  private stopWss(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }

      // Ensure shutdown doesn't hang if clients keep sockets open.
      for (const client of this.wss.clients) {
        client.terminate();
      }

      this.wss.close(() => resolve());
    });
  }

  // ─── Incoming message router ──────────────────────────────────────────────

  private async handleMessage(ws: WebSocket, raw: Buffer): Promise<void> {
    let envelope: WsEnvelope;

    try {
      envelope = JSON.parse(raw.toString()) as WsEnvelope;
    } catch {
      this.send(ws, 'error', { message: 'Invalid JSON' });
      return;
    }

    const { event, data } = envelope;

    try {
      switch (event) {
        case 'post.open':
          await this.handlePostOpen(ws, data);
          break;
        case 'post.update':
          await this.handlePostUpdate(ws, data);
          break;
        case 'post.listByAuthor':
          await this.handlePostListByAuthor(ws, data);
          break;
        case 'post.get':
          await this.handlePostGet(ws, data);
          break;
        case 'post.delete':
          await this.handlePostDelete(ws, data);
          break;
        case 'suggest.spellcheck':
          await this.handleSuggestSpellcheck(ws, data);
          break;
        case 'suggest.rewrite':
          await this.handleSuggestRewrite(ws, data);
          break;
        case 'suggest.continue':
          await this.handleSuggestContinue(ws, data);
          break;
        case 'suggest.apply':
          await this.handleSuggestApply(ws, data);
          break;
        case 'ai.settings.get':
          await this.handleAiSettingsGet(ws, data);
          break;
        case 'ai.settings.update':
          await this.handleAiSettingsUpdate(ws, data);
          break;
        case 'ai.settings.clearKey':
          await this.handleAiSettingsClearKey(ws, data);
          break;
        default:
          this.send(ws, 'error', { message: `Unknown event: ${event}` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      this.logger.warn(`[${event}] error:`, msg);
      this.send(ws, 'error', { message: msg, event });
    }
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  private async handlePostOpen(ws: WebSocket, data: unknown): Promise<void> {
    const payload = validate(PostOpenSchema, data);

    const snapshot = await this.broker.call<
      {
        postId: string;
        contentJson: Record<string, unknown>;
        version: number;
        workspaceId: string;
      },
      typeof payload
    >('posts.open', payload);

    if (!snapshot?.postId) {
      throw new Error('posts.open returned an invalid snapshot');
    }

    // Join the post room
    this.joinRoom(ws, snapshot.postId);
    const meta = this.clientMeta.get(ws) ?? {};
    meta.postId = snapshot.postId;
    meta.userId = payload.userId;
    meta.workspaceId = snapshot.workspaceId || payload.workspaceId;
    this.clientMeta.set(ws, meta);

    const msg: PostSnapshotMessage = {
      postId: snapshot.postId,
      contentJson: snapshot.contentJson,
      version: snapshot.version,
      workspaceId: snapshot.workspaceId,
    };
    this.send(ws, 'post.snapshot', msg);
  }

  private async handlePostUpdate(ws: WebSocket, data: unknown): Promise<void> {
    const payload = validate(PostUpdateSchema, data);

    const result = await this.broker.call<
      { postId: string; version: number; staleSuggestionIds: string[] },
      typeof payload
    >('posts.update', payload);

    // post.ack is sent only to the originating socket
    const ack: PostAckMessage = {
      postId: result.postId,
      version: result.version,
    };
    this.send(ws, 'post.ack', ack);

    // suggest.removed is broadcast to all room members
    // (the post.updated event handler also does this — but only if using broker events;
    //  here we rely on the event, so nothing extra needed)
  }

  private async handlePostListByAuthor(
    ws: WebSocket,
    data: unknown,
  ): Promise<void> {
    const payload = validate(PostListByAuthorSchema, data);

    const result = await this.broker.call<
      PostListMessage,
      typeof payload
    >('posts.listByAuthor', payload);

    this.send(ws, 'post.list', result);
  }

  private async handlePostGet(ws: WebSocket, data: unknown): Promise<void> {
    const payload = validate(PostGetSchema, data);

    const result = await this.broker.call<
      PostDetailMessage,
      typeof payload
    >('posts.get', payload);

    this.send(ws, 'post.detail', result);
  }

  private async handlePostDelete(ws: WebSocket, data: unknown): Promise<void> {
    const payload = validate(PostDeleteSchema, data);
    await this.broker.call('posts.delete', { postId: payload.postId });
    // Broadcast goes only to room members; the requester may not be in this post's
    // room (e.g. deleting from the sidebar while viewing another post), so send
    // directly as well. applyPostDeleted on the client is idempotent.
    this.send(ws, 'post.deleted', { postId: payload.postId });
  }

  private async handleSuggestSpellcheck(
    ws: WebSocket,
    data: unknown,
  ): Promise<void> {
    const payload = validate(SuggestSpellcheckSchema, data);
    const workspaceId =
      payload.workspaceId ??
      await this.resolveWorkspaceIdForPost(ws, payload.postId);

    this.sendSuggestLoading(ws, {
      postId: payload.postId,
      version: payload.version,
      type: 'spellcheck',
      status: 'start',
    });

    try {
      const { issues } = await this.broker.call<
        { issues: Array<{ from: number; to: number; original: string; replacements: string[]; message: string; confidence: number }> },
        {
          plainText: string;
          selectedText?: string;
          selection?: { from: number; to: number };
          workspaceId?: string;
        }
      >('ai.spellcheck', {
        plainText: payload.plainText,
        selectedText: payload.selectedText,
        selection: payload.selection,
        workspaceId,
      });

      // Persist each issue as a suggestion and emit suggestion.ready
      await Promise.all(
        issues.map((issue) =>
          this.broker.call('suggestions.create', {
            postId: payload.postId,
            version: payload.version,
            type: 'spellcheck',
            rangeFrom: issue.from,
            rangeTo: issue.to,
            payload: {
              title: 'Опечатка',
              message: issue.message,
              replacements: issue.replacements,
              confidence: issue.confidence,
            },
          }),
        ),
      );

      this.sendSuggestLoading(ws, {
        postId: payload.postId,
        version: payload.version,
        type: 'spellcheck',
        status: 'done',
      });
    } catch (err) {
      this.sendSuggestLoading(ws, {
        postId: payload.postId,
        version: payload.version,
        type: 'spellcheck',
        status: 'error',
        message: err instanceof Error ? err.message : 'Internal error',
      });
      throw err;
    }
  }

  private async handleSuggestRewrite(
    ws: WebSocket,
    data: unknown,
  ): Promise<void> {
    const payload = validate(SuggestRewriteSchema, data);
    const workspaceId =
      payload.workspaceId ??
      await this.resolveWorkspaceIdForPost(ws, payload.postId);

    this.sendSuggestLoading(ws, {
      postId: payload.postId,
      version: payload.version,
      type: 'rewrite',
      status: 'start',
    });

    try {
      const result = await this.broker.call<
        { variants: Array<{ text: string; style?: string; diff?: string }>; confidence: number },
        {
          selectedText: string;
          contextText: string;
          selection: { from: number; to: number };
          workspaceId?: string;
        }
      >('ai.rewrite', {
        selectedText: payload.selectedText,
        contextText: payload.contextText,
        selection: payload.selection,
        workspaceId,
      });

      const styles = result.variants.map((v) => v.style).filter((s): s is string => !!s);
      await this.broker.call('suggestions.create', {
        postId: payload.postId,
        version: payload.version,
        type: 'rewrite',
        rangeFrom: payload.selection.from,
        rangeTo: payload.selection.to,
        payload: {
          title: 'Переформулировка',
          message: 'Предлагаем переписать фрагмент',
          replacements: result.variants.map((v) => v.text),
          ...(styles.length > 0 && { styles }),
          diff: result.variants[0]?.diff,
          confidence: result.confidence,
        },
      });

      this.sendSuggestLoading(ws, {
        postId: payload.postId,
        version: payload.version,
        type: 'rewrite',
        status: 'done',
      });
    } catch (err) {
      this.sendSuggestLoading(ws, {
        postId: payload.postId,
        version: payload.version,
        type: 'rewrite',
        status: 'error',
        message: err instanceof Error ? err.message : 'Internal error',
      });
      throw err;
    }
  }

  private async handleSuggestContinue(
    ws: WebSocket,
    data: unknown,
  ): Promise<void> {
    const payload = validate(SuggestContinueSchema, data);
    const workspaceId =
      payload.workspaceId ??
      await this.resolveWorkspaceIdForPost(ws, payload.postId);

    this.sendSuggestLoading(ws, {
      postId: payload.postId,
      version: payload.version,
      type: 'continue',
      status: 'start',
    });

    try {
      const result = await this.broker.call<
        { insertText: string; confidence: number },
        {
          contextText: string;
          cursorPos: number;
          intent: string;
          workspaceId?: string;
        }
      >('ai.continue', {
        contextText: payload.contextText,
        cursorPos: payload.cursorPos,
        intent: payload.intent,
        workspaceId,
      });

      await this.broker.call('suggestions.create', {
        postId: payload.postId,
        version: payload.version,
        type: 'continue',
        rangeFrom: payload.cursorPos,
        rangeTo: payload.cursorPos,
        payload: {
          title: 'Продолжение текста',
          message: '',
          replacements: [],
          insertText: result.insertText,
          confidence: result.confidence,
        },
      });

      this.sendSuggestLoading(ws, {
        postId: payload.postId,
        version: payload.version,
        type: 'continue',
        status: 'done',
      });
    } catch (err) {
      this.sendSuggestLoading(ws, {
        postId: payload.postId,
        version: payload.version,
        type: 'continue',
        status: 'error',
        message: err instanceof Error ? err.message : 'Internal error',
      });
      throw err;
    }
  }

  private async handleSuggestApply(
    ws: WebSocket,
    data: unknown,
  ): Promise<void> {
    const payload = validate(SuggestApplySchema, data);

    await this.broker.call('suggestions.apply', {
      postId: payload.postId,
      version: payload.version,
      suggestionId: payload.suggestionId,
      action: payload.action,
    });
    // suggest.removed will be broadcast via the suggestion.removed event handler
  }

  private async handleAiSettingsGet(
    ws: WebSocket,
    data: unknown,
  ): Promise<void> {
    const payload = validate(AiSettingsGetSchema, data);
    const settings = await this.broker.call<AiSettingsMessage, typeof payload>(
      'ai-settings.get',
      payload,
    );
    this.send(ws, 'ai.settings', settings);
  }

  private async handleAiSettingsUpdate(
    ws: WebSocket,
    data: unknown,
  ): Promise<void> {
    const payload = validate(AiSettingsUpdateSchema, data);
    const settings = await this.broker.call<AiSettingsMessage, typeof payload>(
      'ai-settings.update',
      payload,
    );
    this.send(ws, 'ai.settings', settings);
  }

  private async handleAiSettingsClearKey(
    ws: WebSocket,
    data: unknown,
  ): Promise<void> {
    const payload = validate(AiSettingsClearKeySchema, data);
    const settings = await this.broker.call<AiSettingsMessage, typeof payload>(
      'ai-settings.clearApiKey',
      payload,
    );
    this.send(ws, 'ai.settings', settings);
  }

  // ─── Internal event subscribers ───────────────────────────────────────────

  private onPostUpdated(evt: PostUpdatedEvent): void {
    // Broadcast suggest.removed for each stale suggestion
    for (const suggestionId of evt.staleSuggestionIds) {
      const msg: SuggestRemovedMessage = {
        postId: evt.postId,
        suggestionId,
      };
      this.broadcast(evt.postId, 'suggest.removed', msg);
    }
  }

  private onPostDeleted(evt: PostDeletedEvent): void {
    this.broadcast(evt.postId, 'post.deleted', { postId: evt.postId });
    this.rooms.delete(evt.postId);
  }

  private onSuggestionReady(evt: SuggestionReadyEvent): void {
    const msg: SuggestResultMessage = {
      postId: evt.postId,
      version: evt.version,
      suggestion: evt.suggestion,
    };
    this.broadcast(evt.postId, 'suggest.result', msg);
  }

  private onSuggestionRemoved(evt: SuggestionRemovedEvent): void {
    const msg: SuggestRemovedMessage = {
      postId: evt.postId,
      suggestionId: evt.suggestionId,
    };
    this.broadcast(evt.postId, 'suggest.removed', msg);
  }

  // ─── Room management ──────────────────────────────────────────────────────

  private joinRoom(ws: WebSocket, postId: string): void {
    // Leave any previous room first
    const meta = this.clientMeta.get(ws);
    if (meta?.postId) {
      this.leaveRoom(ws, meta.postId);
    }

    if (!this.rooms.has(postId)) {
      this.rooms.set(postId, new Set());
    }
    this.rooms.get(postId)!.add(ws);
  }

  private leaveRoom(ws: WebSocket, postId: string): void {
    const room = this.rooms.get(postId);
    if (!room) return;
    room.delete(ws);
    if (room.size === 0) {
      this.rooms.delete(postId);
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    const meta = this.clientMeta.get(ws);
    if (meta?.postId) {
      this.leaveRoom(ws, meta.postId);
    }
    this.clientMeta.delete(ws);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private send<T>(ws: WebSocket, event: string, data: T): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ event, data }));
  }

  private broadcast<T>(postId: string, event: string, data: T): void {
    const room = this.rooms.get(postId);
    if (!room) return;
    const payload = JSON.stringify({ event, data });
    for (const client of room) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private sendSuggestLoading(
    ws: WebSocket,
    payload: SuggestLoadingMessage,
  ): void {
    const room = this.rooms.get(payload.postId);
    if (room) {
      this.broadcast(payload.postId, 'suggest.loading', payload);
      // If requester is not joined yet (or room is stale), still deliver direct feedback.
      if (!room.has(ws)) {
        this.send(ws, 'suggest.loading', payload);
      }
      return;
    }
    this.send(ws, 'suggest.loading', payload);
  }

  private async resolveWorkspaceIdForPost(
    ws: WebSocket,
    postId: string,
  ): Promise<string | undefined> {
    const meta = this.clientMeta.get(ws);
    if (meta?.postId === postId && meta.workspaceId) {
      return meta.workspaceId;
    }

    try {
      const post = await this.broker.call<{ workspaceId: string }, { postId: string }>(
        'posts.get',
        { postId },
      );

      if (typeof post.workspaceId === 'string' && post.workspaceId.length > 0) {
        if (meta?.postId === postId) {
          meta.workspaceId = post.workspaceId;
          this.clientMeta.set(ws, meta);
        }
        return post.workspaceId;
      }
    } catch (error) {
      this.logger.warn(
        `Unable to resolve workspaceId for post ${postId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }

    return undefined;
  }

  // ─── Expose internals for testing ─────────────────────────────────────────

  public getRooms(): Map<string, Set<WebSocket>> {
    return this.rooms;
  }

  public getClientMeta(): Map<WebSocket, ClientMeta> {
    return this.clientMeta;
  }
}
