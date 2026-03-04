import { Context, Errors, Service, ServiceBroker } from 'moleculer';
import prisma from '../lib/prisma';
import type {
  SuggestionApplyParams,
  SuggestionCreateParams,
  SuggestionRemovedEvent,
  SuggestionReadyEvent,
  SuggestionResult,
} from '../types';

/**
 * suggestions.service
 *
 * Owns suggestion CRUD:
 * - create: persists a suggestion and emits suggestion.ready for the gateway
 * - apply: accept or reject a suggestion, emits suggestion.removed
 *
 * The service deliberately knows nothing about WebSocket clients — it
 * communicates through the Moleculer event bus.
 */
export default class SuggestionsService extends Service {
  private parsePayload(
    payload: string | Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    if (!payload) {
      return {};
    }

    if (typeof payload !== 'string') {
      return payload;
    }

    try {
      const parsed = JSON.parse(payload) as unknown;
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  public constructor(broker: ServiceBroker) {
    super(broker);

    this.parseServiceSchema({
      name: 'suggestions',

      actions: {
        /**
         * Persist a suggestion and notify the gateway.
         * Called by the ai.service pipeline after it generates results.
         */
        create: {
          handler: (ctx: Context<SuggestionCreateParams>) =>
            this.createSuggestion(ctx),
        },

        /**
         * Accept or reject a suggestion.
         * Emits suggestion.removed so the gateway can push suggest.removed to clients.
         */
        apply: {
          handler: (ctx: Context<SuggestionApplyParams>) =>
            this.applySuggestion(ctx),
        },
      },
    });
  }

  // ─── Handlers ────────────────────────────────────────────────────────────

  private async createSuggestion(ctx: Context<SuggestionCreateParams>) {
    const { postId, version, type, rangeFrom, rangeTo, payload } = ctx.params;

    // Verify post exists
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new Errors.MoleculerClientError(
        `Post ${postId} not found`,
        404,
        'POST_NOT_FOUND',
      );
    }

    const suggestion = await prisma.suggestion.create({
      data: {
        postId,
        version,
        type,
        rangeFrom,
        rangeTo,
        payload: JSON.stringify(payload ?? {}),
        status: 'pending',
      },
    });

    // Build the result shape that the gateway will forward to clients
    const p = this.parsePayload(suggestion.payload);
    const result: SuggestionResult = {
      id: suggestion.id,
      type,
      range: { from: rangeFrom, to: rangeTo },
      title: (p['title'] as string | undefined) ?? type,
      message: (p['message'] as string | undefined) ?? '',
      replacements: (p['replacements'] as string[] | undefined) ?? [],
      styles: (p['styles'] as string[] | undefined),
      diff: p['diff'] as string | undefined,
      insertText: p['insertText'] as string | undefined,
      confidence: (p['confidence'] as number | undefined) ?? 1.0,
    };

    const event: SuggestionReadyEvent = { postId, version, suggestion: result };
    this.broker.emit('suggestion.ready', event);

    return result;
  }

  private async applySuggestion(ctx: Context<SuggestionApplyParams>) {
    const { postId, suggestionId, action } = ctx.params;

    const suggestion = await prisma.suggestion.findFirst({
      where: { id: suggestionId, postId },
    });

    if (!suggestion) {
      throw new Errors.MoleculerClientError(
        `Suggestion ${suggestionId} not found`,
        404,
        'SUGGESTION_NOT_FOUND',
      );
    }

    if (suggestion.status !== 'pending') {
      throw new Errors.MoleculerClientError(
        `Suggestion ${suggestionId} is already ${suggestion.status}`,
        409,
        'SUGGESTION_NOT_PENDING',
        { currentStatus: suggestion.status },
      );
    }

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';

    await prisma.suggestion.update({
      where: { id: suggestionId },
      data: { status: newStatus },
    });

    const event: SuggestionRemovedEvent = { postId, suggestionId };
    this.broker.emit('suggestion.removed', event);

    return { suggestionId, status: newStatus };
  }
}
