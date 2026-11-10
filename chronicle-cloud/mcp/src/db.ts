// Database access for the MCP server: PostgREST calls made WITH THE CALLER'S OWN TOKEN, so Row
// Level Security applies exactly as it does on the website. There is no service key here.
import { ERROR_CODES, type ErrorCode } from '../../src/lib/changeSetTypes.ts';

export class ToolError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly detail: Record<string, unknown> = {}) {
    super(message);
  }
}

export interface Db {
  get<T>(pathAndQuery: string): Promise<T[]>;
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
}

export function makeDb(base: string, publishableKey: string, token: string, fetchImpl: typeof fetch): Db {
  const root = `${base.replace(/\/+$/, '')}/rest/v1`;
  const headers = { apikey: publishableKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  async function fail(res: Response): Promise<never> {
    let body: { message?: string; details?: string | null; code?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      body = {};
    }
    const code = (ERROR_CODES as readonly string[]).includes(body.message ?? '') ? (body.message as ErrorCode) : null;
    let detail: Record<string, unknown>;
    try {
      detail = body.details ? (JSON.parse(body.details) as Record<string, unknown>) : {};
    } catch {
      detail = {};
    }
    if (code) {
      const { message, ...rest } = detail;
      throw new ToolError(code, typeof message === 'string' ? message : code, rest);
    }
    if (res.status === 401) throw new ToolError('UNAUTHENTICATED', 'Sign in again.');
    if (res.status === 403 || body.code === '42501') throw new ToolError('FORBIDDEN', 'Not allowed.');
    if (res.status >= 500) throw new ToolError('DEPENDENCY_UNAVAILABLE', 'Chronicle\'s database is not reachable.');
    // Never pass database text through.
    throw new ToolError('INTERNAL_ERROR', 'Chronicle could not complete the request.');
  }
  return {
    async get<T>(pathAndQuery: string) {
      const res = await fetchImpl(`${root}/${pathAndQuery}`, { headers });
      if (!res.ok) return fail(res);
      return (await res.json()) as T[];
    },
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      const res = await fetchImpl(`${root}/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
      if (!res.ok) return fail(res);
      return (await res.json()) as T;
    },
  };
}
