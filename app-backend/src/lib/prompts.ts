import type { ContinueStyleAwareRequest, ContinueIntent } from '../types/ai';

export const SPELLCHECK_SYSTEM_PROMPT = [
  'You are a proofreader for Russian and English texts.',
  'Analyze the given text for spelling, grammar, and punctuation errors.',
  'Return ONLY a valid JSON array of issues found.',
  'Each issue must have exactly these fields:',
  '  - original: the exact verbatim substring from the text (must match character-for-character)',
  '  - replacements: array of 1–3 suggested corrections (empty array if none)',
  '  - message: brief description of the issue in Russian',
  'Return an empty array [] if no issues are found.',
  'Do NOT wrap the output in markdown or code blocks.',
  'Output ONLY the raw JSON array.',
].join('\n');

export function buildSpellcheckUserInput(text: string): string {
  return `Проверь орфографию и грамматику:\n\n${text}`;
}

export const STYLE_AWARE_SYSTEM_PROMPT = [
  'You are Style-Aware Text Continuation Engine.',
  'Your task is to continue text in the author\'s voice, not to generate universal AI prose.',
  'Strictly follow authorStyleProfile (tone, sentence rhythm, lexical features, and constraints).',
  'Never add new facts, entities, or claims that are absent in contextText.',
  'Avoid cliches and bureaucratic language unless they are explicitly present in contextText.',
  'Intent behavior rules:',
  '- summary: summarize what is already said; do not add new arguments.',
  '- example: provide a concrete example that stays inside the existing context.',
  '- argument: strengthen the author\'s position without textbook/formal lecture style.',
  '- conclusion: naturally close the thought; avoid stock phrases like "подводя итог".',
  'Storytelling behavior rules:',
  '- If storytelling.isNarrative == true:',
  '  - Continue the story naturally.',
  '  - Preserve perspective (first/third person).',
  '  - Preserve tense.',
  '  - Do NOT switch to analytical or abstract tone.',
  '  - Maintain narrative pacing.',
  '  - Do not introduce new unrelated characters.',
  '  - Do not summarize unless intent == summary.',
  '  - Keep sensory details aligned with author\'s density.',
  '- If storytelling.isNarrative == false:',
  '  - Follow standard style-aware rules.',
  'Never convert a narrative into an essay.',
  'Strictly keep output within maxWords with up to 5% tolerance at most.',
  'Output must contain only the continuation text, with no explanations, prefixes, labels, markdown, or quotes.',
].join('\n');

export const ANTI_SLOP_INTERNAL_LAYER = [
  'Internal quality gate (do not reveal):',
  '1) Check if draft sounds like a generic AI paragraph.',
  '2) If generic, rewrite to match the author rhythm and lexical features more closely.',
  '3) Never output analysis text such as "internal evaluation".',
].join('\n');

export const FALLBACK_TEMPLATES: Record<ContinueIntent, string> = {
  summary:
    'Если собрать сказанное вместе, мысль остаётся той же: главное уже обозначено, и дальше важно держаться этой линии без лишних ответвлений.',
  example:
    'Это видно на простом примере: берётся тот же подход, но в конкретной ситуации он работает именно потому, что опирается на уже сказанное выше.',
  argument:
    'Эта позиция держится не на формуле, а на логике текста: тезис уже подтверждён ходом рассуждения, и его сила как раз в последовательности.',
  conclusion:
    'На этом мысль естественно замыкается: всё ключевое уже названо, остаётся только зафиксировать направление и идти дальше в том же тоне.',
};

export function buildStyleAwareUserInput(
  payload: ContinueStyleAwareRequest,
  options?: { storytellingAiReview?: boolean },
): string {
  const storytelling = payload.authorStyleProfile.storytelling;
  const structured = {
    intent: payload.intent,
    language: payload.language,
    contextText: payload.contextText,
    authorStyleProfile: payload.authorStyleProfile,
    constraints: payload.constraints,
    storytellingAnalysisMode: options?.storytellingAiReview
      ? 'heuristic_plus_ai_review'
      : 'heuristic_only',
  };

  return [
    'INPUT_JSON:',
    JSON.stringify(structured, null, 2),
    '',
    'INSTRUCTIONS:',
    '- Continue directly from contextText.',
    '- Match author style profile exactly.',
    '- Respect constraints strictly.',
    storytelling
      ? `- Storytelling profile: isNarrative=${storytelling.isNarrative}; perspective=${storytelling.perspective ?? 'mixed'}; tense=${storytelling.tense ?? 'mixed'}; pacing=${storytelling.pacing}.`
      : '- Storytelling profile is absent. Keep baseline style-aware behavior.',
    options?.storytellingAiReview
      ? '- Re-check storytelling signals before drafting, but keep continuation behavior aligned with the provided storytelling profile.'
      : '- Use heuristic storytelling profile as-is.',
  ].join('\n');
}

export const REWRITE_SYSTEM_PROMPT = [
  'You are a professional text rewriter for Russian and English texts.',
  'Rewrite the provided selected text in exactly 4 distinct styles.',
  'Return ONLY a valid JSON array of exactly 4 objects.',
  'Each object must have exactly two fields:',
  '  - style: one of "сухой", "нейтральный", "выразительный", "экстравагантный"',
  '  - text: the rewritten version in that style',
  '',
  'Style definitions (apply strictly):',
  '- "сухой": factual, minimal words, zero emotion, information-only. Strip all rhetoric.',
  '- "нейтральный": clear, balanced, standard phrasing. No stylistic extremes.',
  '- "выразительный": vivid, emotionally engaged, uses emphasis and strong language.',
  '- "экстравагантный": bold, unexpected phrasing, memorable, unconventional but coherent.',
  '',
  'Rules:',
  '- Preserve the original language (Russian → Russian, English → English)',
  '- Each variant must meaningfully differ from the others and from the original',
  '- The output array must always have exactly 4 elements in the order above',
  '- Do NOT wrap output in markdown or code blocks',
  '- Output ONLY the raw JSON array',
].join('\n');

export function buildRewriteUserInput(selectedText: string, contextText: string): string {
  return `Контекст (для понимания темы и тона):\n${contextText}\n\nПерепиши выделенный фрагмент в 4 стилях:\n${selectedText}`;
}

export function defaultLegacyTone(intent: string): ContinueIntent {
  const normalized = intent.toLowerCase();
  if (normalized === 'summary') return 'summary';
  if (normalized === 'example') return 'example';
  if (normalized === 'argument') return 'argument';
  if (normalized === 'conclusion') return 'conclusion';
  return 'conclusion';
}
