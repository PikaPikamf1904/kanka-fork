import { describe, expect, it } from 'vitest';
import { NOTICE, readStatus } from './status.ts';

describe('readStatus', () => {
  it('is off unless MAINTENANCE_MODE=on, and then gives only the notice text', () => {
    expect(readStatus({})).toEqual({ notice: false, message: null });
    expect(readStatus({ MAINTENANCE_MODE: 'off' })).toEqual({ notice: false, message: null });
    expect(readStatus({ MAINTENANCE_MODE: 'ON' })).toEqual({ notice: true, message: NOTICE });
  });
});
