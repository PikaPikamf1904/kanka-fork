// Client for the editing engine (migration 20261111000900). The database is the authority: it
// validates, diffs, checks versions and applies everything in one transaction. This module only
// shapes requests and turns errors into stable codes. Shared by the website and the MCP server.
import { ChronicleError, toChronicleError, type ApplyResult, type ChangeSet, type Preview } from './changeSetTypes.ts';
import { supabase } from './supabase.ts';

export * from './changeSetTypes.ts';

export async function previewChanges(changeSet: ChangeSet): Promise<Preview> {
  const { data, error } = await supabase.rpc('preview_change_set', { p_change_set: changeSet });
  if (error) throw toChronicleError(error);
  return data as Preview;
}

/** Record a human approval of a preview. Only works from the website, never from an OAuth client. */
export async function approvePreview(previewId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_change_preview', { p_preview_id: previewId });
  if (error) throw toChronicleError(error);
}

export async function applyChanges(preview: Pick<Preview, 'preview_id' | 'digest'>, idempotencyKey: string): Promise<ApplyResult> {
  if (!preview.preview_id || !preview.digest) throw new ChronicleError('CONFLICT', 'This preview has conflicts and cannot be applied.');
  const { data, error } = await supabase.rpc('apply_change_set', {
    p_preview_id: preview.preview_id, p_digest: preview.digest, p_idempotency_key: idempotencyKey,
  });
  if (error) throw toChronicleError(error);
  return data as ApplyResult;
}

export const newIdempotencyKey = () => crypto.randomUUID();
