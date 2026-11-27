import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, zipFiles } from '../../src/lib/zip.ts';

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes an archive that a standard ZIP reader opens, with UTF-8 names and contents intact', () => {
    const files = [
      { path: 'Chronicle-Export/README.md', text: '# Hello\n' },
      { path: 'Chronicle-Export/Characters/Lady Mirelle d’Aubrac.md', text: 'Café – “quotes” – 竜\n' },
      { path: 'Chronicle-Export/Characters/Captain Rhys O\'Dell.md', text: '' },
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
    const zip = path.join(dir, 'out.zip');
    fs.writeFileSync(zip, zipFiles(files));
    const read = execFileSync('python3', ['-I', '-c', `
import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps({n: z.read(n).decode('utf-8') for n in z.namelist()}))
`, zip], { encoding: 'utf8' });
    expect(JSON.parse(read)).toEqual(Object.fromEntries(files.map((f) => [f.path, f.text])));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses duplicate names', () => {
    expect(() => zipFiles([{ path: 'a.md', text: '' }, { path: 'a.md', text: '' }])).toThrow(/Duplicate/);
  });
});
