import { Context, Errors, Service, ServiceBroker } from 'moleculer';
import prisma from '../lib/prisma';
import type {
  PostDetailMessage,
  PostListByAuthorParams,
  PostGetParams,
  PostOpenParams,
  PostListMessage,
  PostUpdatedEvent,
  PostUpdateParams,
  PostSnapshotParams,
  SuggestionMarkStaleParams,
  PostDeleteParams,
  PostDeletedEvent,
} from '../types';

/**
 * posts.service
 *
 * Manages post lifecycle and versioning.
 *
 * Version strategy: the client proposes the next version number.
 * The server validates that proposed == currentVersion + 1 (monotonic).
 * This gives the client awareness of the version timeline while the
 * server acts as the source of truth and guards against concurrent writes.
 */
export default class PostsService extends Service {
  private static readonly LIST_ITEM_NAME_MAX_LENGTH = 80;

  private parseContentJson(
    value: string | Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    if (!value) {
      return {};
    }

    if (typeof value !== 'string') {
      return value;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private buildPostListName(plainText: string | null | undefined): string {
    const normalized = (plainText ?? '').replace(/\s+/g, ' ').trim();
    return normalized.slice(0, PostsService.LIST_ITEM_NAME_MAX_LENGTH);
  }

  public constructor(broker: ServiceBroker) {
    super(broker);

    this.parseServiceSchema({
      name: 'posts',

      actions: {
        /**
         * Open or reconnect to a post.
         * - If postId supplied: validate ownership and return current snapshot.
         * - If no postId: create a new post and return initial snapshot.
         */
        open: {
          handler: (ctx: Context<PostOpenParams>) => this.openPost(ctx),
        },

        /**
         * List posts for an author (optionally within one workspace).
         */
        listByAuthor: {
          handler: (ctx: Context<PostListByAuthorParams>) =>
            this.listByAuthor(ctx),
        },

        /**
         * Get one post with its current snapshot.
         */
        get: {
          handler: (ctx: Context<PostGetParams>) => this.getPost(ctx),
        },

        /**
         * Apply a content update. Validates monotonic versioning,
         * persists post_version, and emits post.updated event so the
         * gateway can broadcast post.ack and suggest.removed.
         */
        update: {
          handler: (ctx: Context<PostUpdateParams>) => this.updatePost(ctx),
        },

        /**
         * Return the current snapshot for a post (used by reconnect logic).
         */
        snapshot: {
          handler: (ctx: Context<PostSnapshotParams>) => this.getSnapshot(ctx),
        },

        /**
         * Mark pending suggestions older than a given version as stale.
         * Exposed as a separate action for composability; also called internally by update.
         */
        markSuggestionsStale: {
          handler: (ctx: Context<SuggestionMarkStaleParams>) =>
            this.markSuggestionsStale(ctx),
        },

        /**
         * Soft-delete a post. Sets deletedAt, marks pending suggestions stale,
         * and emits post.deleted so the gateway can broadcast and clean up rooms.
         */
        delete: {
          handler: (ctx: Context<PostDeleteParams>) => this.deletePost(ctx),
        },
      },
    });
  }

  // ─── Handlers ────────────────────────────────────────────────────────────

  private async openPost(ctx: Context<PostOpenParams>) {
    const { workspaceId, userId, postId } = ctx.params;

    if (postId) {
      // Reconnect path: return current snapshot for existing post
      const post = await prisma.post.findUnique({
        where: { id: postId },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      });

      if (!post || post.deletedAt || (workspaceId && post.workspaceId !== workspaceId)) {
        const notFoundMessage = workspaceId
          ? `Post ${postId} not found in workspace ${workspaceId}`
          : `Post ${postId} not found`;
        throw new Errors.MoleculerClientError(
          notFoundMessage,
          404,
          'POST_NOT_FOUND',
        );
      }

      const latestVersion = post.versions[0];
      return {
        postId: post.id,
        contentJson: this.parseContentJson(latestVersion?.contentJson),
        version: post.currentVersion,
        workspaceId: post.workspaceId,
      };
    }

    if (!workspaceId || !userId) {
      throw new Errors.MoleculerClientError(
        'workspaceId and userId are required when postId is not provided',
        422,
        'VALIDATION_ERROR',
      );
    }

    // New post path
    const post = await prisma.$transaction(async (tx) => {
      await tx.workspace.upsert({
        where: { id: workspaceId },
        update: {},
        create: {
          id: workspaceId,
          ownerUserId: userId,
          name: `Workspace ${workspaceId}`,
        },
      });

      const existingUser = await tx.user.findUnique({
        where: { id: userId },
        select: { workspaceId: true },
      });

      if (existingUser && existingUser.workspaceId !== workspaceId) {
        throw new Errors.MoleculerClientError(
          `User ${userId} belongs to workspace ${existingUser.workspaceId}, not ${workspaceId}`,
          409,
          'WORKSPACE_USER_MISMATCH',
        );
      }

      if (!existingUser) {
        await tx.user.create({
          data: {
            id: userId,
            workspaceId,
            name: `User ${userId}`,
          },
        });
      }

      const newPost = await tx.post.create({
        data: {
          workspaceId,
          authorUserId: userId,
          currentVersion: 0,
        },
      });

      // Store initial empty version atomically with post creation.
      await tx.postVersion.create({
        data: {
          postId: newPost.id,
          version: 0,
          contentJson: '{}',
          plainText: '',
        },
      });

      return newPost;
    });

    return {
      postId: post.id,
      contentJson: {} as Record<string, unknown>,
      version: 0,
      workspaceId: post.workspaceId,
    };
  }

  private async updatePost(ctx: Context<PostUpdateParams>) {
    const { postId, contentJson, plainText, version } = ctx.params;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new Errors.MoleculerClientError(
        `Post ${postId} not found`,
        404,
        'POST_NOT_FOUND',
      );
    }

    // Monotonic version guard
    const expected = post.currentVersion + 1;
    if (version !== expected) {
      throw new Errors.MoleculerClientError(
        `Version conflict: expected ${expected}, got ${version}`,
        409,
        'VERSION_CONFLICT',
        { expected, received: version },
      );
    }

    // All writes in a single transaction
    const staleSuggestionIds = await prisma.$transaction(async (tx) => {
      // 1. Collect IDs of suggestions that will become stale
      const stale = await tx.suggestion.findMany({
        where: { postId, status: 'pending', version: { lt: version } },
        select: { id: true },
      });

      // 2. Mark them stale
      if (stale.length > 0) {
        await tx.suggestion.updateMany({
          where: { postId, status: 'pending', version: { lt: version } },
          data: { status: 'stale' },
        });
      }

      // 3. Persist new version snapshot
      await tx.postVersion.create({
        data: {
          postId,
          version,
          contentJson: JSON.stringify(contentJson ?? {}),
          plainText,
        },
      });

      // 4. Advance post.currentVersion
      await tx.post.update({
        where: { id: postId },
        data: { currentVersion: version },
      });

      return stale.map((s) => s.id);
    });

    // Emit event for gateway to forward post.ack + suggest.removed
    const event: PostUpdatedEvent = { postId, version, staleSuggestionIds };
    this.broker.emit('post.updated', event);

    return { postId, version, staleSuggestionIds };
  }

  private async getSnapshot(ctx: Context<PostSnapshotParams>) {
    const { postId } = ctx.params;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!post) {
      throw new Errors.MoleculerClientError(
        `Post ${postId} not found`,
        404,
        'POST_NOT_FOUND',
      );
    }

    const latestVersion = post.versions[0];
    return {
      postId,
      contentJson: this.parseContentJson(latestVersion?.contentJson),
      version: post.currentVersion,
    };
  }

  private async listByAuthor(
    ctx: Context<PostListByAuthorParams>,
  ): Promise<PostListMessage> {
    const {
      authorUserId,
      workspaceId,
      limit = 20,
      offset = 0,
    } = ctx.params;

    const where = {
      authorUserId,
      deletedAt: null,
      ...(workspaceId ? { workspaceId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
            select: { plainText: true },
          },
        },
      }),
      prisma.post.count({ where }),
    ]);

    return {
      items: items.map((post) => ({
        name: this.buildPostListName(post.versions[0]?.plainText),
        version: post.currentVersion,
        postId: post.id,
        workspaceId: post.workspaceId,
        authorUserId: post.authorUserId,
        currentVersion: post.currentVersion,
        createdAt: post.createdAt.toISOString(),
        updatedAt: post.updatedAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  }

  private async getPost(ctx: Context<PostGetParams>): Promise<PostDetailMessage> {
    const { postId, workspaceId } = ctx.params;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!post || post.deletedAt || (workspaceId && post.workspaceId !== workspaceId)) {
      const notFoundMessage = workspaceId
        ? `Post ${postId} not found in workspace ${workspaceId}`
        : `Post ${postId} not found`;
      throw new Errors.MoleculerClientError(
        notFoundMessage,
        404,
        'POST_NOT_FOUND',
      );
    }

    const latestVersion = post.versions[0];
    return {
      postId: post.id,
      workspaceId: post.workspaceId,
      authorUserId: post.authorUserId,
      contentJson: this.parseContentJson(latestVersion?.contentJson),
      plainText: latestVersion?.plainText ?? '',
      version: post.currentVersion,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    };
  }

  private async markSuggestionsStale(ctx: Context<SuggestionMarkStaleParams>) {
    const { postId, beforeVersion } = ctx.params;

    await prisma.suggestion.updateMany({
      where: { postId, status: 'pending', version: { lt: beforeVersion } },
      data: { status: 'stale' },
    });
  }

  private async deletePost(ctx: Context<PostDeleteParams>) {
    const { postId } = ctx.params;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.deletedAt) {
      throw new Errors.MoleculerClientError(
        `Post ${postId} not found`,
        404,
        'POST_NOT_FOUND',
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.post.update({
        where: { id: postId },
        data: { deletedAt: new Date() },
      });
      await tx.suggestion.updateMany({
        where: { postId, status: 'pending' },
        data: { status: 'stale' },
      });
    });

    const event: PostDeletedEvent = { postId };
    this.broker.emit('post.deleted', event);
  }
}
