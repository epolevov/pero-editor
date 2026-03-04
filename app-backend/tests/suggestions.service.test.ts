/**
 * suggestions.service unit tests — Prisma fully mocked, no real DB.
 */

import { ServiceBroker } from 'moleculer';

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    post: {
      findUnique: jest.fn(),
    },
    suggestion: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import SuggestionsService from '../src/services/suggestions.service';
import prisma from '../src/lib/prisma';

const db = prisma as unknown as {
  post: { findUnique: jest.Mock };
  suggestion: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockPost = { id: 'post-1', workspaceId: 'ws-1', authorUserId: 'user-1' };

const pendingSuggestion = {
  id: 'sug-1',
  postId: 'post-1',
  version: 1,
  type: 'spellcheck',
  rangeFrom: 0,
  rangeTo: 5,
  payload: { title: 'Опечатка', message: 'Лишние пробелы', replacements: [' '], confidence: 0.99 },
  status: 'pending',
  createdAt: new Date(),
};

// ─── Setup ───────────────────────────────────────────────────────────────────

let broker: ServiceBroker;
let emitSpy: jest.SpyInstance;

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService(SuggestionsService);
  await broker.start();
});

afterAll(async () => {
  await broker.stop();
});

beforeEach(() => {
  jest.clearAllMocks();
  emitSpy = jest.spyOn(broker, 'emit').mockResolvedValue(undefined as never);
});

afterEach(() => {
  emitSpy.mockRestore();
});

// ─── suggestions.create ───────────────────────────────────────────────────────

describe('suggestions.create', () => {
  it('persists a suggestion and emits suggestion.ready', async () => {
    db.post.findUnique.mockResolvedValueOnce(mockPost);
    db.suggestion.create.mockResolvedValueOnce(pendingSuggestion);

    const result = await broker.call<
      { id: string; type: string; range: { from: number; to: number }; replacements: string[] },
      object
    >('suggestions.create', {
      postId: 'post-1',
      version: 1,
      type: 'spellcheck',
      rangeFrom: 0,
      rangeTo: 5,
      payload: { title: 'Опечатка', message: 'Лишние пробелы', replacements: [' '], confidence: 0.99 },
    });

    expect(db.suggestion.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('sug-1');
    expect(result.type).toBe('spellcheck');
    expect(result.range).toEqual({ from: 0, to: 5 });
    expect(result.replacements).toEqual([' ']);

    expect(emitSpy).toHaveBeenCalledWith(
      'suggestion.ready',
      expect.objectContaining({
        postId: 'post-1',
        version: 1,
        suggestion: expect.objectContaining({ id: 'sug-1' }),
      }),
    );
  });

  it('throws 404 when post does not exist', async () => {
    db.post.findUnique.mockResolvedValueOnce(null);

    await expect(
      broker.call('suggestions.create', {
        postId: 'ghost', version: 1, type: 'spellcheck', rangeFrom: 0, rangeTo: 0, payload: {},
      }),
    ).rejects.toMatchObject({ code: 404 });
  });

  it('maps payload fields to result correctly', async () => {
    db.post.findUnique.mockResolvedValueOnce(mockPost);
    db.suggestion.create.mockResolvedValueOnce({
      ...pendingSuggestion,
      id: 'sug-rewrite',
      type: 'rewrite',
      payload: { title: 'Переформулировка', message: 'Упрости', replacements: ['вариант 1', 'вариант 2'], confidence: 0.8 },
    });

    const result = await broker.call<{ title: string; message: string; confidence: number }, object>(
      'suggestions.create',
      { postId: 'post-1', version: 1, type: 'rewrite', rangeFrom: 0, rangeTo: 10, payload: { title: 'Переформулировка', message: 'Упрости', replacements: ['вариант 1', 'вариант 2'], confidence: 0.8 } },
    );

    expect(result.title).toBe('Переформулировка');
    expect(result.confidence).toBe(0.8);
  });
});

// ─── suggestions.apply — accept ───────────────────────────────────────────────

describe('suggestions.apply — accept', () => {
  it('changes status to accepted and emits suggestion.removed', async () => {
    db.suggestion.findFirst.mockResolvedValueOnce(pendingSuggestion);
    db.suggestion.update.mockResolvedValueOnce({ ...pendingSuggestion, status: 'accepted' });

    const result = await broker.call<{ suggestionId: string; status: string }, object>(
      'suggestions.apply',
      { postId: 'post-1', version: 1, suggestionId: 'sug-1', action: 'accept' },
    );

    expect(db.suggestion.update).toHaveBeenCalledWith({
      where: { id: 'sug-1' },
      data: { status: 'accepted' },
    });
    expect(result.status).toBe('accepted');
    expect(emitSpy).toHaveBeenCalledWith(
      'suggestion.removed',
      expect.objectContaining({ postId: 'post-1', suggestionId: 'sug-1' }),
    );
  });
});

// ─── suggestions.apply — reject ───────────────────────────────────────────────

describe('suggestions.apply — reject', () => {
  it('changes status to rejected and emits suggestion.removed', async () => {
    db.suggestion.findFirst.mockResolvedValueOnce(pendingSuggestion);
    db.suggestion.update.mockResolvedValueOnce({ ...pendingSuggestion, status: 'rejected' });

    const result = await broker.call<{ status: string }, object>(
      'suggestions.apply',
      { postId: 'post-1', version: 1, suggestionId: 'sug-1', action: 'reject' },
    );

    expect(result.status).toBe('rejected');
    expect(emitSpy).toHaveBeenCalledWith('suggestion.removed', expect.any(Object));
  });
});

// ─── suggestions.apply — guards ───────────────────────────────────────────────

describe('suggestions.apply — guards', () => {
  it('throws 404 when suggestion not found', async () => {
    db.suggestion.findFirst.mockResolvedValueOnce(null);

    await expect(
      broker.call('suggestions.apply', { postId: 'post-1', version: 1, suggestionId: 'nope', action: 'accept' }),
    ).rejects.toMatchObject({ code: 404 });
  });

  it('throws 409 when suggestion is already accepted', async () => {
    db.suggestion.findFirst.mockResolvedValueOnce({ ...pendingSuggestion, status: 'accepted' });

    await expect(
      broker.call('suggestions.apply', { postId: 'post-1', version: 1, suggestionId: 'sug-1', action: 'reject' }),
    ).rejects.toMatchObject({ code: 409 });
  });

  it('throws 409 when suggestion is stale', async () => {
    db.suggestion.findFirst.mockResolvedValueOnce({ ...pendingSuggestion, status: 'stale' });

    await expect(
      broker.call('suggestions.apply', { postId: 'post-1', version: 1, suggestionId: 'sug-1', action: 'accept' }),
    ).rejects.toMatchObject({ code: 409 });
  });
});
