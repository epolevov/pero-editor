import { detectStorytelling } from '../src/lib/storytellingDetector';

describe('storytellingDetector', () => {
  it('detects narrative context', () => {
    const context = [
      'Сначала я вошел в пустой двор и услышал, как Анна тихо сказала: "Не оглядывайся".',
      'Потом мы побежали к реке, и в тот момент ветер ударил в лицо.',
    ].join(' ');

    const result = detectStorytelling(context);

    expect(result.isNarrative).toBe(true);
    expect(result.characterDensity).toBeGreaterThan(0.2);
    expect(result.dialogueUsage).toBeGreaterThan(0.05);
    expect(result.perspective).toBe('first_person');
  });

  it('detects essay context as non-narrative', () => {
    const context = [
      'Архитектурное решение важно оценивать через устойчивость и стоимость владения.',
      'В этой модели рассматриваются преимущества декомпозиции и влияние на масштабируемость.',
      'Далее приводится сравнительный анализ по измеримым критериям.',
    ].join(' ');

    const result = detectStorytelling(context);

    expect(result.isNarrative).toBe(false);
    expect(result.dialogueUsage).toBeLessThan(0.05);
  });
});
