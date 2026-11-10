// Types and error codes of the editing engine, free of browser-only imports so the importer,
// tests and the MCP server can share them.
import type { ArticleType } from './types.ts';

export type ProvenanceKind = 'table_confirmed' | 'dm_confirmed' | 'official_reference' | 'planned_unplayed' | 'transcript_uncertain';
export interface Provenance { kind: ProvenanceKind; reference?: string }

export type ChangeOp =
  | { operation: 'create_article'; slug: string; title: string; type: ArticleType; subtitle?: string; summary?: string; is_party_member?: boolean; source_ref?: string; on_exists?: 'skip' | 'conflict' }
  | { operation: 'patch_article'; slug: string; expected_version?: string; fields: Partial<Record<'title' | 'subtitle' | 'summary' | 'is_party_member' | 'importance' | 'session_date' | 'hero_media_id', unknown>> }
  | { operation: 'upsert_section'; article_slug: string; expected_version?: string; section_id?: string | null; heading?: string; body: string; position?: number; provenance?: Provenance }
  | { operation: 'remove_section'; article_slug: string; expected_version?: string; section_id: string }
  | { operation: 'upsert_infobox_field'; article_slug: string; expected_version?: string; field_id?: string | null; label: string; value?: string; position?: number; provenance?: Provenance }
  | { operation: 'remove_infobox_field'; article_slug: string; expected_version?: string; field_id: string }
  | { operation: 'add_relation'; source_slug: string; expected_version?: string; target_slug: string; kind: string; label?: string }
  | { operation: 'remove_relation'; relation_id: string; expected_version?: string }
  | { operation: 'add_category_link' | 'remove_category_link'; article_slug: string; expected_version?: string; category_slug: string }
  | { operation: 'add_dm_note'; article_slug: string; expected_version?: string; title?: string; body: string }
  | { operation: 'restore_revision'; article_slug: string; expected_version?: string; revision_id: string };

export interface ChangeSet {
  label?: string;
  source_kind?: ProvenanceKind;
  expected_versions?: Record<string, string>;
  changes: ChangeOp[];
}

export interface Diff { target: string; field: string; before: unknown; after: unknown; operation: 'create' | 'patch' | 'remove' | 'restore'; section_id?: string; field_id?: string }
export interface Warning { code: string; message: string; index?: number; target_slug?: string }
export interface Preview {
  preview_id: string | null;
  digest: string | null;
  expires_at: string | null;
  review_required: true;
  diffs: Diff[];
  warnings: Warning[];
  conflicts: { slug: string; code?: string; expected?: string; current?: string }[];
  created: string[];
  updated: string[];
  skipped: string[];
}
export interface ApplyResult {
  schema_version: '1';
  change_set_id: string;
  preview_id: string;
  created: string[];
  updated: string[];
  skipped: string[];
  new_versions: Record<string, string>;
  revision_ids: { slug: string; revision_id: string }[];
  warnings: Warning[];
  replayed: boolean;
}

export const ERROR_CODES = [
  'UNAUTHENTICATED', 'FORBIDDEN', 'MFA_REQUIRED', 'INSUFFICIENT_SCOPE', 'NOT_FOUND', 'VALIDATION_FAILED', 'CONFLICT',
  'ALREADY_EXISTS', 'PREVIEW_EXPIRED', 'IDEMPOTENCY_MISMATCH', 'RATE_LIMITED', 'DEPENDENCY_UNAVAILABLE', 'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
