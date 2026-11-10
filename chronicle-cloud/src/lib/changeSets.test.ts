import { describe, expect, it } from 'vitest';
import { ChronicleError, toChronicleError } from './changeSetTypes.ts';

describe('toChronicleError', () => {
  it('maps engine errors to their stable code and message', () => {
    const e = toChronicleError({ message: 'CONFLICT', details: JSON.stringify({ slug: 'a', message: '"a" changed.' }), code: 'PT409' });
    expect(e).toBeInstanceOf(ChronicleError);
    expect(e).toMatchObject({ code: 'CONFLICT', message: '"a" changed.', detail: { slug: 'a' } });
  });

  it('never passes database text through for unknown errors', () => {
    const e = toChronicleError({ message: 'relation "public.secret_table" does not exist', details: 'SELECT ...', code: '42P01' });
    expect(e).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Chronicle could not complete the request.' });
    expect(JSON.stringify(e.detail)).toBe('{}');
  });

  it('maps permission errors to FORBIDDEN and tolerates bad detail JSON', () => {
    expect(toChronicleError({ message: 'permission denied for function x', code: '42501' }).code).toBe('FORBIDDEN');
    expect(toChronicleError({ message: 'VALIDATION_FAILED', details: '{not json' })).toMatchObject({ code: 'VALIDATION_FAILED', message: 'VALIDATION_FAILED' });
    expect(toChronicleError(null).code).toBe('INTERNAL_ERROR');
  });
});
