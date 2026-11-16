import { describe, expect, it } from 'vitest';
import { parseSearch } from './searchQuery.ts';

describe('parseSearch', () => {
  it('takes out type and category operators and keeps the database syntax as it is', () => {
    expect(parseSearch('"red hand" -dragon type:characters category:"Silver Quill"')).toEqual({
      text: '"red hand" -dragon', types: ['character'], categories: ['silver-quill'], unknown: [],
    });
    expect(parseSearch('type:location type:Locations harbour')).toMatchObject({ text: 'harbour', types: ['location'] });
    expect(parseSearch('kind:session journal')).toMatchObject({ text: 'journal', types: ['session'] });
  });
  it('reports unknown kinds and leaves ordinary colons alone', () => {
    expect(parseSearch('type:dragons fire')).toMatchObject({ text: 'fire', types: [], unknown: ['type:dragons'] });
    expect(parseSearch('Time: 12:30')).toMatchObject({ text: 'Time: 12:30', types: [] });
  });
});
