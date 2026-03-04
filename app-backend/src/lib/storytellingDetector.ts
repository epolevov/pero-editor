import type {
  StorytellingPacing,
  StorytellingPerspective,
  StorytellingProfile,
  StorytellingTense,
} from '../types/ai';

const SEQUENCE_MARKERS = [
  'сначала',
  'потом',
  'затем',
  'в тот момент',
  'после этого',
  'before',
  'then',
  'after that',
  'at that moment',
  'suddenly',
];

const ACTION_VERBS = [
  'пошел',
  'пошла',
  'пошли',
  'сказал',
  'сказала',
  'побежал',
  'побежала',
  'вошел',
  'вошла',
  'вышел',
  'вышла',
  'opened',
  'closed',
  'ran',
  'walked',
  'said',
  'looked',
  'turned',
  'stepped',
  'grabbed',
];

const FIRST_PERSON_MARKERS = [
  'я',
  'мне',
  'меня',
  'мой',
  'моё',
  'мы',
  'нас',
  'our',
  'ours',
  'i',
  'me',
  'my',
  'mine',
  'we',
  'us',
];

const THIRD_PERSON_MARKERS = [
  'он',
  'она',
  'они',
  'его',
  'ее',
  'её',
  'их',
  'him',
  'her',
  'his',
  'their',
  'they',
  'he',
  'she',
];

function splitWords(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[\p{L}\p{N}'-]+/gu) ?? [];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function countByList(words: string[], values: string[]): number {
  const lookup = new Set(values);
  return words.reduce((acc, word) => acc + (lookup.has(word) ? 1 : 0), 0);
}

function countDialogueMarkers(text: string): number {
  const lineDialogue = (text.match(/(?:^|\n)\s*[-—]\s+/g) ?? []).length;
  const quoteDialogue = (text.match(/["«»“”]/g) ?? []).length;
  return lineDialogue + Math.floor(quoteDialogue / 2);
}

function countProperNames(text: string): number {
  const tokens = text.match(/\b[\p{Lu}][\p{Ll}]{2,}\b/gu) ?? [];
  return tokens.length;
}

function countSequenceMarkers(textLower: string): number {
  return SEQUENCE_MARKERS.reduce((acc, marker) => {
    let from = 0;
    let localCount = 0;
    while (from < textLower.length) {
      const index = textLower.indexOf(marker, from);
      if (index < 0) break;
      localCount += 1;
      from = index + marker.length;
    }
    return acc + localCount;
  }, 0);
}

function countActionVerbs(words: string[]): number {
  const explicit = countByList(words, ACTION_VERBS);
  const ruVerbLike = words.filter((word) =>
    /(лся|лась|лись|л|ла|ли|ет|ют|ит|ат|ется|ются)$/.test(word),
  ).length;
  const enVerbLike = words.filter((word) =>
    /(ed|ing)$/.test(word),
  ).length;
  return explicit + Math.floor((ruVerbLike + enVerbLike) * 0.25);
}

function detectPerspective(words: string[], properNamesCount: number): StorytellingPerspective {
  const firstCount = countByList(words, FIRST_PERSON_MARKERS);
  const thirdCount = countByList(words, THIRD_PERSON_MARKERS) + Math.floor(properNamesCount * 0.5);

  if (firstCount === 0 && thirdCount === 0) {
    return 'mixed';
  }

  if (firstCount > thirdCount * 1.25) return 'first_person';
  if (thirdCount > firstCount * 1.25) return 'third_person';
  return 'mixed';
}

function detectTense(words: string[]): StorytellingTense {
  const pastCount =
    words.filter((word) => /(лся|лась|лись|л|ла|ли)$/.test(word)).length +
    words.filter((word) => /(ed)$/.test(word)).length +
    countByList(words, ['was', 'were', 'had']);

  const presentCount =
    words.filter((word) => /(ет|ют|ит|ат|ется|ются)$/.test(word)).length +
    countByList(words, ['is', 'are', 'do', 'does']) +
    words.filter((word) => /(ing)$/.test(word)).length;

  if (pastCount === 0 && presentCount === 0) {
    return 'mixed';
  }

  if (pastCount > presentCount * 1.2) return 'past';
  if (presentCount > pastCount * 1.2) return 'present';
  return 'mixed';
}

function detectPacing(
  sentenceCount: number,
  wordsCount: number,
  dialogueUsage: number,
  actionDensity: number,
): StorytellingPacing {
  const avgSentenceLength = sentenceCount > 0 ? wordsCount / sentenceCount : wordsCount;

  if (avgSentenceLength < 11 || dialogueUsage > 0.4 || actionDensity > 0.2) {
    return 'fast';
  }
  if (avgSentenceLength > 20 && dialogueUsage < 0.2 && actionDensity < 0.1) {
    return 'slow';
  }
  return 'medium';
}

export function detectStorytelling(contextText: string): StorytellingProfile {
  const text = contextText.trim();
  const words = splitWords(text);
  const wordsCount = words.length;
  const sentenceCount = Math.max(
    1,
    (text.match(/[.!?…]+/g) ?? []).length,
  );

  const dialogueMarkers = countDialogueMarkers(text);
  const properNamesCount = countProperNames(text);
  const firstPersonCount = countByList(words, FIRST_PERSON_MARKERS);
  const thirdPersonCount = countByList(words, THIRD_PERSON_MARKERS);
  const actionVerbCount = countActionVerbs(words);
  const sequenceCount = countSequenceMarkers(text.toLowerCase());

  const characterSignals = properNamesCount + firstPersonCount + thirdPersonCount;
  const characterDensity = clamp01(
    wordsCount > 0 ? characterSignals / Math.max(1, wordsCount * 0.35) : 0,
  );
  const dialogueUsage = clamp01(dialogueMarkers / Math.max(1, sentenceCount * 1.8));
  const actionDensity = wordsCount > 0 ? actionVerbCount / wordsCount : 0;

  const explicitSequence = sequenceCount >= 2 || (sequenceCount >= 1 && actionDensity > 0.08);
  const isNarrative = characterDensity + dialogueUsage > 0.6 || explicitSequence;

  return {
    isNarrative,
    perspective: detectPerspective(words, properNamesCount),
    tense: detectTense(words),
    characterDensity,
    dialogueUsage,
    pacing: detectPacing(sentenceCount, wordsCount, dialogueUsage, actionDensity),
  };
}
