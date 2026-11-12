import { describe, expect, it } from 'vitest';
import { splitTimestamp } from './journal.ts';

describe('splitTimestamp', () => {
  it('takes a transcript range off the end of a heading', () => {
    expect(splitTimestamp('A limited debrief (01:42–05:15)')).toEqual({ text: 'A limited debrief', source: '01:42–05:15' });
    expect(splitTimestamp('The projected foe (28:54–1:01:25)')).toEqual({ text: 'The projected foe', source: '28:54–1:01:25' });
    expect(splitTimestamp('The warning [1:02:20 - 1:02:52]')).toEqual({ text: 'The warning', source: '1:02:20 - 1:02:52' });
    expect(splitTimestamp('Arrival (00:12)')).toEqual({ text: 'Arrival', source: '00:12' });
  });
  it('leaves ordinary headings alone', () => {
    for (const h of ['Recap', 'Chapter 12: The 3 doors', 'Ratio 3:2 (approximately)', '']) {
      expect(splitTimestamp(h)).toEqual({ text: h, source: null });
    }
  });
});
