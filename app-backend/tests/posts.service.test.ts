/**
 * posts.service unit tests — Prisma fully mocked, no real DB.
 *
 * Note on jest.mock() hoisting:
 *   Jest hoists jest.mock() calls before imports, so the factory function
 *   cannot reference variables declared in the module scope.
 *   We define the mock inline inside the factory and then import the module
 *   to get a typed reference to the mock fns.
 */

import { ServiceBroker } from 'moleculer';

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    workspace: {
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    post: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    postVersion: {
      create: jest.fn(),
    },
    suggestion: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

// Import AFTER mock registration so we get the mocked module
import PostsService from '../src/services/posts.service';
import prisma from '../src/lib/prisma';

// Typed shorthand for mock access
const db = prisma as unknown as {
  workspace: { upsert: jest.Mock };
  user: { findUnique: jest.Mock; create: jest.Mock };
  post: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  postVersion: { create: jest.Mock };
  suggestion: { findMany: jest.Mock; updateMany: jest.Mock };
  $transaction: jest.Mock;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockPost = {
  id: 'post-1',
  workspaceId: 'ws-1',
  authorUserId: 'user-1',
  currentVersion: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPostVersion = {
  id: 'pv-1',
  postId: 'post-1',
  version: 1,
  contentJson: { type: 'doc', content: [] },
  plainText: 'Hello world',
  createdAt: new Date(),
};

// ─── Setup ───────────────────────────────────────────────────────────────────

let broker: ServiceBroker;

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService(PostsService);
  await broker.start();
});

afterAll(async () => {
  await broker.stop();
});

beforeEach(() => jest.clearAllMocks());

// ─── posts.open ───────────────────────────────────────────────────────────────

describe('posts.open', () => {
  it('creates a new post when no postId supplied', async () => {
    db.$transaction.mockImplementationOnce(async (fn: (tx: typeof db) => Promise<typeof mockPost>) => {
      db.workspace.upsert.mockResolvedValueOnce({
        id: 'ws-1',
        ownerUserId: 'user-1',
        name: 'Workspace ws-1',
        createdAt: new Date(),
      });
      db.user.findUnique.mockResolvedValueOnce(null);
      db.user.create.mockResolvedValueOnce({
        id: 'user-1',
        workspaceId: 'ws-1',
        name: 'User user-1',
        email: null,
        createdAt: new Date(),
      });
      db.post.create.mockResolvedValueOnce(mockPost);
      db.postVersion.create.mockResolvedValueOnce({
        id: 'pv-0', postId: 'post-1', version: 0, contentJson: {}, plainText: '', createdAt: new Date(),
      });
      return fn(db);
    });

    const result = await broker.call<
      { postId: string; contentJson: unknown; version: number },
      { workspaceId: string; userId: string }
    >('posts.open', { workspaceId: 'ws-1', userId: 'user-1' });

    expect(db.workspace.upsert).toHaveBeenCalledTimes(1);
    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
    expect(db.user.create).toHaveBeenCalledTimes(1);
    expect(db.post.create).toHaveBeenCalledTimes(1);
    expect(db.postVersion.create).toHaveBeenCalledTimes(1);
    expect(result.postId).toBe('post-1');
    expect(result.version).toBe(0);
    expect(result.contentJson).toEqual({});
  });

  it('creates a new post without creating user when user already exists in workspace', async () => {
    db.$transaction.mockImplementationOnce(async (fn: (tx: typeof db) => Promise<typeof mockPost>) => {
      db.workspace.upsert.mockResolvedValueOnce({
        id: 'ws-1',
        ownerUserId: 'user-1',
        name: 'Workspace ws-1',
        createdAt: new Date(),
      });
      db.user.findUnique.mockResolvedValueOnce({ workspaceId: 'ws-1' });
      db.post.create.mockResolvedValueOnce(mockPost);
      db.postVersion.create.mockResolvedValueOnce({
        id: 'pv-0', postId: 'post-1', version: 0, contentJson: {}, plainText: '', createdAt: new Date(),
      });
      return fn(db);
    });

    const result = await broker.call<
      { postId: string; contentJson: unknown; version: number },
      { workspaceId: string; userId: string }
    >('posts.open', { workspaceId: 'ws-1', userId: 'user-1' });

    expect(db.user.create).not.toHaveBeenCalled();
    expect(result.postId).toBe('post-1');
    expect(result.version).toBe(0);
    expect(result.contentJson).toEqual({});
  });

  it('throws 409 when user belongs to a different workspace', async () => {
    db.$transaction.mockImplementationOnce(async (fn: (tx: typeof db) => Promise<typeof mockPost>) => {
      db.workspace.upsert.mockResolvedValueOnce({
        id: 'ws-1',
        ownerUserId: 'user-1',
        name: 'Workspace ws-1',
        createdAt: new Date(),
      });
      db.user.findUnique.mockResolvedValueOnce({ workspaceId: 'ws-2' });
      return fn(db);
    });

    await expect(
      broker.call('posts.open', { workspaceId: 'ws-1', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 409, type: 'WORKSPACE_USER_MISMATCH' });
  });

  it('returns existing snapshot on reconnect (postId supplied)', async () => {
    db.post.findUnique.mockResolvedValueOnce({
      ...mockPost,
      currentVersion: 3,
      versions: [{ ...mockPostVersion, version: 3, contentJson: { v: 3 } }],
    });

    const result = await broker.call<
      { postId: string; contentJson: unknown; version: number },
      { postId: string }
    >('posts.open', { postId: 'post-1' });

    expect(db.post.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'post-1' } }),
    );
    expect(result.version).toBe(3);
    expect(result.contentJson).toEqual({ v: 3 });
  });

  it('throws 404 when reconnecting to unknown post', async () => {
    db.post.findUnique.mockResolvedValueOnce(null);

    await expect(
      broker.call('posts.open', { postId: 'nonexistent' }),
    ).rejects.toMatchObject({ code: 404 });
  });
});

// ─── posts.update ─────────────────────────────────────────────────────────────

describe('posts.update', () => {
  it('accepts update with correct monotonic version', async () => {
    db.post.findUnique.mockResolvedValueOnce({ ...mockPost, currentVersion: 0 });

    db.$transaction.mockImplementationOnce(async (fn: (tx: typeof db) => Promise<string[]>) => {
      db.suggestion.findMany.mockResolvedValueOnce([]);
      db.suggestion.updateMany.mockResolvedValueOnce({ count: 0 });
      db.postVersion.create.mockResolvedValueOnce(mockPostVersion);
      db.post.update.mockResolvedValueOnce({ ...mockPost, currentVersion: 1 });
      return fn(db);
    });

    const emitSpy = jest.spyOn(broker, 'emit').mockResolvedValue(undefined as never);

    const result = await broker.call<
      { postId: string; version: number; staleSuggestionIds: string[] },
      { postId: string; contentJson: object; plainText: string; version: number }
    >('posts.update', { postId: 'post-1', contentJson: { type: 'doc' }, plainText: 'Hello', version: 1 });

    expect(result.postId).toBe('post-1');
    expect(result.version).toBe(1);
    expect(result.staleSuggestionIds).toEqual([]);
    expect(emitSpy).toHaveBeenCalledWith('post.updated', expect.objectContaining({ postId: 'post-1', version: 1 }));

    emitSpy.mockRestore();
  });

  it('rejects update when version is not currentVersion + 1', async () => {
    db.post.findUnique.mockResolvedValueOnce({ ...mockPost, currentVersion: 5 });

    await expect(
      broker.call('posts.update', { postId: 'post-1', contentJson: {}, plainText: '', version: 3 }),
    ).rejects.toMatchObject({ code: 409 });
  });

  it('marks pending suggestions stale and returns their ids', async () => {
    db.post.findUnique.mockResolvedValueOnce({ ...mockPost, currentVersion: 2 });

    db.$transaction.mockImplementationOnce(async (fn: (tx: typeof db) => Promise<string[]>) => {
      db.suggestion.findMany.mockResolvedValueOnce([{ id: 'sug-1' }, { id: 'sug-2' }]);
      db.suggestion.updateMany.mockResolvedValueOnce({ count: 2 });
      db.postVersion.create.mockResolvedValueOnce(mockPostVersion);
      db.post.update.mockResolvedValueOnce({ ...mockPost, currentVersion: 3 });
      return fn(db);
    });

    jest.spyOn(broker, 'emit').mockResolvedValue(undefined as never);

    const result = await broker.call<
      { staleSuggestionIds: string[] },
      { postId: string; contentJson: object; plainText: string; version: number }
    >('posts.update', { postId: 'post-1', contentJson: {}, plainText: '', version: 3 });

    expect(result.staleSuggestionIds).toEqual(['sug-1', 'sug-2']);
  });

  it('throws 404 when post does not exist', async () => {
    db.post.findUnique.mockResolvedValueOnce(null);

    await expect(
      broker.call('posts.update', { postId: 'ghost', contentJson: {}, plainText: '', version: 1 }),
    ).rejects.toMatchObject({ code: 404 });
  });
});

// ─── posts.snapshot ───────────────────────────────────────────────────────────

describe('posts.snapshot', () => {
  it('returns current content and version', async () => {
    db.post.findUnique.mockResolvedValueOnce({
      ...mockPost,
      currentVersion: 2,
      versions: [{ ...mockPostVersion, version: 2, contentJson: { type: 'doc' } }],
    });

    const result = await broker.call<
      { postId: string; contentJson: unknown; version: number },
      { postId: string }
    >('posts.snapshot', { postId: 'post-1' });

    expect(result.postId).toBe('post-1');
    expect(result.version).toBe(2);
    expect(result.contentJson).toEqual({ type: 'doc' });
  });

  it('throws 404 when post not found', async () => {
    db.post.findUnique.mockResolvedValueOnce(null);

    await expect(
      broker.call('posts.snapshot', { postId: 'nope' }),
    ).rejects.toMatchObject({ code: 404 });
  });
});

// ─── posts.listByAuthor ─────────────────────────────────────────────────────

describe('posts.listByAuthor', () => {
  it('returns author posts with total count', async () => {
    db.post.findMany.mockResolvedValueOnce([
      {
        ...mockPost,
        id: 'post-2',
        currentVersion: 4,
        versions: [{ plainText: 'Первый заголовок из начала статьи' }],
      },
      {
        ...mockPost,
        id: 'post-1',
        currentVersion: 2,
        versions: [{ plainText: 'Второй текст статьи' }],
      },
    ]);
    db.post.count.mockResolvedValueOnce(2);

    const result = await broker.call<
      {
        items: Array<{ postId: string; version: number; name: string }>;
        total: number;
        limit: number;
        offset: number;
      },
      { authorUserId: string; limit: number; offset: number }
    >('posts.listByAuthor', { authorUserId: 'user-1', limit: 10, offset: 0 });

    expect(db.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { authorUserId: 'user-1', deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        skip: 0,
        include: expect.objectContaining({
          versions: expect.objectContaining({
            orderBy: { version: 'desc' },
            take: 1,
            select: { plainText: true },
          }),
        }),
      }),
    );
    expect(db.post.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authorUserId: 'user-1', deletedAt: null } }),
    );
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.postId).toBe('post-2');
    expect(result.items[0]?.version).toBe(4);
    expect(result.items[0]?.name).toBe('Первый заголовок из начала статьи');
  });
});

// ─── posts.get ──────────────────────────────────────────────────────────────

describe('posts.get', () => {
  it('returns one post with latest snapshot', async () => {
    db.post.findUnique.mockResolvedValueOnce({
      ...mockPost,
      currentVersion: 2,
      versions: [{ ...mockPostVersion, version: 2, contentJson: { type: 'doc' }, plainText: 'Current text' }],
    });

    const result = await broker.call<
      { postId: string; version: number; plainText: string; contentJson: unknown },
      { postId: string }
    >('posts.get', { postId: 'post-1' });

    expect(result.postId).toBe('post-1');
    expect(result.version).toBe(2);
    expect(result.plainText).toBe('Current text');
    expect(result.contentJson).toEqual({ type: 'doc' });
  });

  it('throws 404 for unknown post', async () => {
    db.post.findUnique.mockResolvedValueOnce(null);

    await expect(
      broker.call('posts.get', { postId: 'missing' }),
    ).rejects.toMatchObject({ code: 404, type: 'POST_NOT_FOUND' });
  });

  it('throws 404 for soft-deleted post', async () => {
    // findUnique returns the post but it has deletedAt set — service checks and rejects.
    db.post.findUnique.mockResolvedValueOnce({
      ...mockPost,
      deletedAt: new Date(),
      versions: [],
    });

    await expect(
      broker.call('posts.get', { postId: 'post-1' }),
    ).rejects.toMatchObject({ code: 404, type: 'POST_NOT_FOUND' });
  });
});

// ─── posts.delete ────────────────────────────────────────────────────────────

describe('posts.delete', () => {
  it('soft-deletes post and emits post.deleted', async () => {
    db.post.findUnique.mockResolvedValueOnce({ ...mockPost, deletedAt: null });

    db.$transaction.mockImplementationOnce(async (fn: (tx: typeof db) => Promise<void>) => {
      db.post.update.mockResolvedValueOnce({ ...mockPost, deletedAt: new Date() });
      db.suggestion.updateMany.mockResolvedValueOnce({ count: 0 });
      return fn(db);
    });

    const emitSpy = jest.spyOn(broker, 'emit').mockResolvedValue(undefined as never);

    await broker.call('posts.delete', { postId: 'post-1' });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'post-1' }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
    expect(db.suggestion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { postId: 'post-1', status: 'pending' }, data: { status: 'stale' } }),
    );
    expect(emitSpy).toHaveBeenCalledWith('post.deleted', { postId: 'post-1' });

    emitSpy.mockRestore();
  });

  it('throws 404 when post does not exist', async () => {
    db.post.findUnique.mockResolvedValueOnce(null);

    await expect(
      broker.call('posts.delete', { postId: 'ghost' }),
    ).rejects.toMatchObject({ code: 404, type: 'POST_NOT_FOUND' });
  });

  it('throws 404 when post is already deleted', async () => {
    db.post.findUnique.mockResolvedValueOnce({ ...mockPost, deletedAt: new Date() });

    await expect(
      broker.call('posts.delete', { postId: 'post-1' }),
    ).rejects.toMatchObject({ code: 404, type: 'POST_NOT_FOUND' });
  });
});

// ─── posts.listByAuthor — deleted posts filtered ───────────────────────────

describe('posts.listByAuthor — deleted filtering', () => {
  it('excludes deleted posts by passing deletedAt: null in where clause', async () => {
    db.post.findMany.mockResolvedValueOnce([{ ...mockPost, id: 'post-2', versions: [{ plainText: '' }] }]);
    db.post.count.mockResolvedValueOnce(1);

    const result = await broker.call<
      { items: Array<{ postId: string }>; total: number },
      { authorUserId: string }
    >('posts.listByAuthor', { authorUserId: 'user-1' });

    expect(db.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
    expect(db.post.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
    expect(result.total).toBe(1);
  });
});
