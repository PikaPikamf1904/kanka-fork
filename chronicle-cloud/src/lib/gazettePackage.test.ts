import { describe, expect, it } from 'vitest';
import { duplicateHeadlines, parseGazettePackage, reporterForByline } from './gazettePackage.ts';
// A synthetic package laid out like the DM's real ones (no campaign content).
import sample from '../../tests/fixtures/gazette-package.sample.md?raw';

describe('Gazette package import', () => {
  const { stories, notes } = parseGazettePackage(sample, 'America/Phoenix');

  it('finds every story and ignores the instructions before the first one', () => {
    expect(notes).toEqual([]);
    expect(stories.map((s) => s.headline)).toEqual(['Synthetic Wagon Found Under a Bridge', 'Synthetic Soup: Food or Philosophy?', 'Synthetic Bells Heard']);
    expect(stories.some((s) => /instructions/.test(s.body))).toBe(false);
  });

  it('reads subtitle, byline, staff key, reliability and section', () => {
    expect(stories[0]).toMatchObject({ subtitle: 'Three geese rescued; one refuses to comment.', byline: 'Gribble Inkfinger, Senior Military Correspondent', reporter: 'gribble', reliability: 'rumor', section: null, problems: [] });
    expect(stories[1]).toMatchObject({ reporter: 'bogwart', reliability: 'satire', section: 'local', problems: [] });
  });

  it('keeps the body exactly as written (Markdown, headings, lists, quotes, bold, the editor\'s note)', () => {
    expect(stories[0]!.body).toBe([
      'A wagon was found **exactly** where it was left.', '', '### A Most Unusual Wagon', '', '- It had wheels.', '- It had more wheels.', '',
      '> "Wheels," said a witness.', '', "**Editor's note:** We regret the wheels.",
    ].join('\n'));
    expect(stories[1]!.body).toBe('The soup was hot.');
  });

  it('reads 05:45 as Arizona time (no daylight saving), giving 12:45 UTC', () => {
    expect(stories.map((s) => s.suggestedAt)).toEqual(['2026-11-26T12:45:00.000Z', '2026-11-28T12:45:00.000Z', '2026-11-29T12:45:00.000Z']);
    // Without a zone label the campaign zone is used.
    const plain = parseGazettePackage('## 2026-07-01 05:45 — Summer Story\n\n**By Professor Bogwart, Department of Questionable Science**\n**Reliability: Satire**\n\nText.', 'America/Phoenix');
    expect(plain.stories[0]!.suggestedAt).toBe('2026-07-01T12:45:00.000Z');
  });

  it('flags a byline that is not on the staff list instead of guessing', () => {
    expect(stories[2]!.reporter).toBeNull();
    expect(stories[2]!.problems.join(' ')).toMatch(/not on the Gazette staff list/);
    expect(reporterForByline('By Gribble Inkfinger, Investigative Correspondent')).toBe('gribble-investigative');
    expect(reporterForByline('Gribble Inkfinger, Investigative')).toBeNull();
  });

  it('reports missing pieces and an empty file', () => {
    expect(parseGazettePackage('Just some text.', 'UTC').notes[0]).toMatch(/No stories found/);
    const bad = parseGazettePackage('## 2026-11-26 05:45 MST — No Byline\n\nText only.', 'UTC').stories[0]!;
    expect(bad.problems.join(' ')).toMatch(/No byline.*No reliability/);
  });

  it('detects duplicates inside the file and against existing headlines', () => {
    const twice = parseGazettePackage(`${sample}\n---\n\n## 2026-11-30 05:45 MST — synthetic wagon found under a bridge\n\n**By Gribble Inkfinger, Senior Military Correspondent**\n**Reliability: Rumor**\n\nAgain.`, 'UTC');
    const dup = duplicateHeadlines(twice.stories, ['  SYNTHETIC SOUP: food or philosophy? ']);
    expect([...dup.entries()]).toEqual([[2, 'Already on the news desk or in the Gazette.'], [4, 'Same headline as story 1 in this file.']]);
  });

  it('a top-level heading after a story ends it: notes or letters at the end are never printed', () => {
    const md = [
      '## 2026-12-01 05:45 MST — Synthetic Last Story', '**By Professor Bogwart, Department of Questionable Science**', '**Reliability: Satire**',
      '', 'The soup was cold.', '', '### Still part of the story', 'Yes.', '---', '',
      '# Letters (enter by hand)', '', 'Dear Editor, this is a letter and must not be printed.', '',
    ].join('\n');
    const { stories: s } = parseGazettePackage(md, 'America/Phoenix');
    expect(s).toHaveLength(1);
    expect(s[0]!.body).toBe('The soup was cold.\n\n### Still part of the story\nYes.');
    expect(s[0]!.body).not.toMatch(/Dear Editor/);
  });
});
