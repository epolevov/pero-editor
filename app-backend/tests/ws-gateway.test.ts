/**
 * api-gateway-ws.service unit tests.
 *
 * No real network: WebSocketServer is mocked to fire 'listening' immediately
 * via setImmediate so that broker.start() resolves without a real port.
 * Messages are injected directly via the private handleMessage method.
 */

import { ServiceBroker } from 'moleculer';

// ─── Mocks must be registered before any imports that use them ───────────────

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {},
}));

// Mock ws so no real port is bound but the Promise in startWss() still resolves.
jest.mock('ws', () => {
  const actual = jest.requireActual<typeof import('ws')>('ws');

  class MockWSS {
    private listeners: Map<string, Array<(...args: unknown[]) => void>> = new Map();

    constructor() {
      // Fire 'listening' asynchronously so the Promise resolves
      setImmediate(() => this._emit('listening'));
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event)!.push(cb);
      return this;
    }

    private _emit(event: string, ...args: unknown[]) {
      (this.listeners.get(event) ?? []).forEach((cb) => cb(...args));
    }

    close(cb?: () => void) {
      cb?.();
    }
  }

  return { ...actual, WebSocketServer: MockWSS };
});

import ApiGatewayWsService from '../src/services/api-gateway-ws.service';
import { WebSocket } from 'ws';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFakeWs(): WebSocket {
  return { readyState: WebSocket.OPEN, send: jest.fn() } as unknown as WebSocket;
}

function envelope(event: string, data: object): Buffer {
  return Buffer.from(JSON.stringify({ event, data }));
}

// Reach into private methods for test injection
type GwPrivate = {
  handleMessage(ws: WebSocket, raw: Buffer): Promise<void>;
  joinRoom(ws: WebSocket, postId: string): void;
  onPostUpdated(evt: object): void;
  onSuggestionReady(evt: object): void;
  onSuggestionRemoved(evt: object): void;
};

function gw(broker: ServiceBroker): GwPrivate {
  const svc = broker.services.find((s) => s.name === 'api-gateway-ws');
  if (!svc) throw new Error('service not found');
  return svc as unknown as GwPrivate;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

let broker: ServiceBroker;
let callSpy: jest.SpyInstance;
let emitSpy: jest.SpyInstance;

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService(ApiGatewayWsService);
  await broker.start();
}, 15_000);

afterAll(async () => {
  await broker.stop();
});

beforeEach(() => {
  callSpy = jest.spyOn(broker, 'call').mockResolvedValue({
    postId: 'post-1',
    contentJson: {},
    version: 1,
    staleSuggestionIds: [],
  } as never);
  emitSpy = jest.spyOn(broker, 'emit').mockResolvedValue(undefined as never);
});

afterEach(() => {
  callSpy?.mockRestore();
  emitSpy?.mockRestore();
});

// ─── Routing tests ───────────────────────────────────────────────────────────

describe('WS Gateway — routing', () => {
  it('routes post.open → posts.open, replies with post.snapshot', async () => {
    const ws = makeFakeWs();

    await gw(broker).handleMessage(ws, envelope('post.open', { workspaceId: 'ws-1', userId: 'u-1' }));

    expect(callSpy).toHaveBeenCalledWith('posts.open', expect.objectContaining({ workspaceId: 'ws-1', userId: 'u-1' }));

    const frame = JSON.parse((ws.send as jest.Mock).mock.calls[0][0]);
    expect(frame.event).toBe('post.snapshot');
    expect(frame.data).toHaveProperty('postId');
  });

  it('routes reconnect post.open { postId } → posts.open, replies with post.snapshot', async () => {
    const ws = makeFakeWs();

    await gw(broker).handleMessage(ws, envelope('post.open', { postId: 'post-1' }));

    expect(callSpy).toHaveBeenCalledWith('posts.open', expect.objectContaining({ postId: 'post-1' }));

    const frame = JSON.parse((ws.send as jest.Mock).mock.calls[0][0]);
    expect(frame.event).toBe('post.snapshot');
    expect(frame.data.postId).toBe('post-1');
  });

  it('routes post.update → posts.update, replies with post.ack', async () => {
    const ws = makeFakeWs();

    await gw(broker).handleMessage(
      ws,
      envelope('post.update', { postId: 'post-1', contentJson: { type: 'doc' }, plainText: 'hello', version: 1 }),
    );

    expect(callSpy).toHaveBeenCalledWith('posts.update', expect.objectContaining({ postId: 'post-1', version: 1 }));

    const frame = JSON.parse((ws.send as jest.Mock).mock.calls[0][0]);
    expect(frame.event).toBe('post.ack');
  });

  it('routes post.listByAuthor → posts.listByAuthor, replies with post.list', async () => {
    callSpy.mockImplementation(async (action: string) => {
      if (action === 'posts.listByAuthor') {
        return {
          items: [{
            name: 'Начало статьи',
            version: 2,
            postId: 'post-1',
            workspaceId: 'ws-1',
            authorUserId: 'u-1',
            currentVersion: 2,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }],
          total: 1,
          limit: 20,
          offset: 0,
        };
      }
      return {};
    });

    const ws = makeFakeWs();
    await gw(broker).handleMessage(
      ws,
      envelope('post.listByAuthor', { authorUserId: 'u-1', limit: 20, offset: 0 }),
    );

    expect(callSpy).toHaveBeenCalledWith(
      'posts.listByAuthor',
      expect.objectContaining({ authorUserId: 'u-1', limit: 20, offset: 0 }),
    );

    const frame = JSON.parse((ws.send as jest.Mock).mock.calls[0][0]);
    expect(frame.event).toBe('post.list');
    expect(frame.data.total).toBe(1);
  });

  it('routes post.get → posts.get, replies with post.detail', async () => {
    callSpy.mockImplementation(async (action: string) => {
      if (action === 'posts.get') {
        return {
          postId: 'post-1',
          workspaceId: 'ws-1',
          authorUserId: 'u-1',
          contentJson: { type: 'doc' },
          plainText: 'Hello',
          version: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      return {};
    });

    const ws = makeFakeWs();
    await gw(broker).handleMessage(ws, envelope('post.get', { postId: 'post-1' }));

    expect(callSpy).toHaveBeenCalledWith(
      'posts.get',
      expect.objectContaining({ postId: 'post-1' }),
    );

    const frame = JSON.parse((ws.send as jest.Mock).mock.calls[0][0]);
    expect(frame.event).toBe('post.detail');
    expect(frame.data.postId).toBe('post-1');
  });

  it('routes suggest.spellcheck → ai.spellcheck then suggestions.create for each issue', async () => {
    callSpy.mockImplementation(async (action: string) => {
      if (action === 'ai.spellcheck') {
        return { issues: [{ from: 5, to: 7, original: '  ', replacements: [' '], message: 'Лишние пробелы', confidence: 0.99 }] };
      }
      return {};
    });

    const ws = makeFakeWs();
    await gw(broker).handleMessage(
      ws,
      envelope('suggest.spellcheck', { postId: 'post-1', version: 1, plainText: 'hello  world' }),
    );

    expect(callSpy).toHaveBeenCalledWith('ai.spellcheck', expect.objectContaining({ plainText: 'hello  world' }));
    expect(callSpy).toHaveBeenCalledWith(
      'suggestions.create',
      expect.objectContaining({ postId: 'post-1', type: 'spellcheck', rangeFrom: 5, rangeTo: 7 }),
    );
  });

  it('routes suggest.rewrite → ai.rewrite then suggestions.create', async () => {
    callSpy.mockImplementation(async (action: string) => {
      if (action === 'ai.rewrite') return { variants: [{ text: 'Вариант 1' }], confidence: 0.8 };
      return {};
    });

    const ws = makeFakeWs();
    await gw(broker).handleMessage(
      ws,
      envelope('suggest.rewrite', {
        postId: 'post-1', version: 1,
        selection: { from: 0, to: 10 },
        selectedText: 'в общем, текст',
        contextText: 'контекст',
      }),
    );

    expect(callSpy).toHaveBeenCalledWith('ai.rewrite', expect.objectContaining({ selectedText: 'в общем, текст' }));
    expect(callSpy).toHaveBeenCalledWith('suggestions.create', expect.objectContaining({ type: 'rewrite' }));
  });

  it('sends suggest.loading start and done for suggest.rewrite', async () => {
    callSpy.mockImplementation(async (action: string) => {
      if (action === 'ai.rewrite') return { variants: [{ text: 'Вариант 1' }], confidence: 0.8 };
      return {};
    });

    const ws = makeFakeWs();
    await gw(broker).handleMessage(
      ws,
      envelope('suggest.rewrite', {
        postId: 'post-1',
        version: 1,
        selection: { from: 0, to: 10 },
        selectedText: 'в общем, текст',
        contextText: 'контекст',
      }),
    );

    const frames = (ws.send as jest.Mock).mock.calls.map((c: string[]) => JSON.parse(c[0]));
    const loadingFrames = frames.filter((f: { event: string }) => f.event === 'suggest.loading');
    expect(loadingFrames).toHaveLength(2);
    expect(loadingFrames[0].data.status).toBe('start');
    expect(loadingFrames[1].data.status).toBe('done');
  });

  it('sends suggest.loading error when suggest.rewrite fails', async () => {
    callSpy.mockImplementation(async (action: string) => {
      if (action === 'ai.rewrite') throw new Error('AI failed');
      return {};
    });

    const ws = makeFakeWs();
    await gw(broker).handleMessage(
      ws,
      envelope('suggest.rewrite', {
        postId: 'post-1',
        version: 1,
        selection: { from: 0, to: 10 },
        selectedText: 'в общем, текст',
        contextText: 'контекст',
      }),
    );

    const frames = (ws.send as jest.Mock).mock.calls.map((c: string[]) => JSON.parse(c[0]));
    const loadingFrames = frames.filter((f: { event: string }) => f.event === 'suggest.loading');
    expect(loadingFrames).toHaveLength(2);
    expect(loadingFrames[0].data.status).toBe('start');
    expect(loadingFrames[1].data.status).toBe('error');
    expect(loadingFrames[1].data.message).toMatch(/ai failed/i);

    const errorFrame = frames.find((f: { event: string }) => f.event === 'error');
    expect(errorFrame?.data.message).toMatch(/ai failed/i);
  });

  it('routes suggest.apply → suggestions.apply', async () => {
    callSpy.mockResolvedValue({ suggestionId: 'sug-1', status: 'accepted' } as never);

    const ws = makeFakeWs();
    await gw(broker).handleMessage(
      ws,
      envelope('suggest.apply', { postId: 'post-1', version: 1, suggestionId: 'sug-1', action: 'accept' }),
    );

    expect(callSpy).toHaveBeenCalledWith(
      'suggestions.apply',
      expect.objectContaining({ suggestionId: 'sug-1', action: 'accept' }),
    );
  });

  it('routes ai.settings.get → ai-settings.get and replies with ai.settings', async () => {
    callSpy.mockImplementation(async (action: string) => {
      if (action === 'ai-settings.get') {
        return {
          workspaceId: 'ws-1',
          hasApiKey: true,
          model: 'google/gemini-2.0-flash-001',
        };
      }
      return {};
    });

    const ws = makeFakeWs();
    await gw(broker).handleMessage(
      ws,
      envelope('ai.settings.get', { workspaceId: 'ws-1' }),
    );

    expect(callSpy).toHaveBeenCalledWith(
      'ai-settings.get',
      expect.objectContaining({ workspaceId: 'ws-1' }),
    );
    const frame = JSON.parse((ws.send as jest.Mock).mock.calls[0][0]);
    expect(frame.event).toBe('ai.settings');
    expect(frame.data.hasApiKey).toBe(true);
  });

  it('routes ai.settings.update → ai-settings.update and replies with ai.settings', async () => {
    callSpy.mockImplementation(async (action: string) => {
      if (action === 'ai-settings.update') {
        return {
          workspaceId: 'ws-1',
          hasApiKey: true,
          model: 'anthropic/claude-sonnet-4-5',
        };
      }
      return {};
    });

    const ws = makeFakeWs();
    await gw(broker).handleMessage(
      ws,
      envelope('ai.settings.update', {
        workspaceId: 'ws-1',
        apiKey: 'sk-test',
      }),
    );

    expect(callSpy).toHaveBeenCalledWith(
      'ai-settings.update',
      expect.objectContaining({ workspaceId: 'ws-1', apiKey: 'sk-test' }),
    );
    const frame = JSON.parse((ws.send as jest.Mock).mock.calls[0][0]);
    expect(frame.event).toBe('ai.settings');
    expect(frame.data.model).toBe('anthropic/claude-sonnet-4-5');
  });

  it('sends error frame on malformed JSON', async () => {
    const ws = makeFakeWs();
    await gw(broker).handleMessage(ws, Buffer.from('not-json'));

    const frame = JSON.parse((ws.send as jest.Mock).mock.calls[0][0]);
    expect(frame.event).toBe('error');
    expect(frame.data.message).toMatch(/invalid json/i);
  });

  it('sends error frame on Zod validation failure', async () => {
    const ws = makeFakeWs();
    // post.open missing userId
    await gw(broker).handleMessage(ws, envelope('post.open', { workspaceId: 'ws-1' }));

    const frame = JSON.parse((ws.send as jest.Mock).mock.calls[0][0]);
    expect(frame.event).toBe('error');
    expect(frame.data.message).toMatch(/validation error/i);
  });

  it('sends error frame on unknown event', async () => {
    const ws = makeFakeWs();
    await gw(broker).handleMessage(ws, envelope('unknown.event', {}));

    const frame = JSON.parse((ws.send as jest.Mock).mock.calls[0][0]);
    expect(frame.event).toBe('error');
  });
});

// ─── Broadcast tests ──────────────────────────────────────────────────────────

describe('WS Gateway — broadcast', () => {
  it('broadcasts suggest.result to all clients in the same room', () => {
    const ws1 = makeFakeWs();
    const ws2 = makeFakeWs();
    const g = gw(broker);

    g.joinRoom(ws1, 'room-a');
    g.joinRoom(ws2, 'room-a');

    g.onSuggestionReady({
      postId: 'room-a',
      version: 1,
      suggestion: { id: 'sug-x', type: 'spellcheck', range: { from: 0, to: 2 }, title: 'Test', message: 'msg', replacements: [' '], confidence: 0.9 },
    });

    for (const ws of [ws1, ws2]) {
      const frames = (ws.send as jest.Mock).mock.calls.map((c: string[]) => JSON.parse(c[0]));
      expect(frames.some((f: { event: string }) => f.event === 'suggest.result')).toBe(true);
    }
  });

  it('broadcasts suggest.removed for each stale suggestion ID from post.updated', () => {
    const ws = makeFakeWs();
    const g = gw(broker);

    g.joinRoom(ws, 'room-stale');
    g.onPostUpdated({ postId: 'room-stale', version: 3, staleSuggestionIds: ['stale-1', 'stale-2'] });

    const frames = (ws.send as jest.Mock).mock.calls.map((c: string[]) => JSON.parse(c[0]));
    const removed = frames.filter((f: { event: string }) => f.event === 'suggest.removed');
    expect(removed).toHaveLength(2);
    expect(removed.map((f: { data: { suggestionId: string } }) => f.data.suggestionId).sort()).toEqual(['stale-1', 'stale-2']);
  });

  it('broadcasts suggest.removed on suggestion.removed event', () => {
    const ws = makeFakeWs();
    const g = gw(broker);

    g.joinRoom(ws, 'room-b');
    g.onSuggestionRemoved({ postId: 'room-b', suggestionId: 'sug-gone' });

    const frames = (ws.send as jest.Mock).mock.calls.map((c: string[]) => JSON.parse(c[0]));
    const removed = frames.find((f: { event: string }) => f.event === 'suggest.removed');
    expect(removed?.data.suggestionId).toBe('sug-gone');
  });

  it('does not send to clients in a different room', () => {
    const wsA = makeFakeWs();
    const wsB = makeFakeWs();
    const g = gw(broker);

    g.joinRoom(wsA, 'room-c');
    g.joinRoom(wsB, 'room-d'); // different room

    g.onSuggestionReady({
      postId: 'room-c',
      version: 1,
      suggestion: { id: 'sug-y', type: 'spellcheck', range: { from: 0, to: 1 }, title: 'T', message: '', replacements: [], confidence: 1 },
    });

    expect((wsB.send as jest.Mock)).not.toHaveBeenCalled();
  });

  it('broadcasts suggest.loading to all clients in the same room', async () => {
    callSpy.mockImplementation(async (action: string) => {
      if (action === 'ai.rewrite') return { variants: [{ text: 'Вариант 1' }], confidence: 0.8 };
      return {};
    });

    const ws1 = makeFakeWs();
    const ws2 = makeFakeWs();
    const g = gw(broker);

    g.joinRoom(ws1, 'post-1');
    g.joinRoom(ws2, 'post-1');

    await g.handleMessage(
      ws1,
      envelope('suggest.rewrite', {
        postId: 'post-1',
        version: 1,
        selection: { from: 0, to: 10 },
        selectedText: 'в общем, текст',
        contextText: 'контекст',
      }),
    );

    for (const ws of [ws1, ws2]) {
      const frames = (ws.send as jest.Mock).mock.calls.map((c: string[]) => JSON.parse(c[0]));
      const loadingFrames = frames.filter((f: { event: string }) => f.event === 'suggest.loading');
      expect(loadingFrames).toHaveLength(2);
      expect(loadingFrames[0].data.status).toBe('start');
      expect(loadingFrames[1].data.status).toBe('done');
    }
  });
});
