import { describe, expect, it } from 'vitest';
import { NOTICE } from './status.ts';

describe('maintenance notice text', () => {
  it('the website copy matches the server copy exactly', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../src/lib/maintenance.ts', import.meta.url), 'utf8'));
    expect(src).toContain(`'${NOTICE}'`);
    expect(NOTICE).not.toMatch(/\b(AI|Claude|ChatGPT|agent|automat)/i);
  });
});
