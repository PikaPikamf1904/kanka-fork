// Cloudflare Worker entry point for the Chronicle MCP server. See docs/chronicle/CONNECT-CHRONICLE-MCP.md.
import { handleRequest, type Env } from './src/server.ts';

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
