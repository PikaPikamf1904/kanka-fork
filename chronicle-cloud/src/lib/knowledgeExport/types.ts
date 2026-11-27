import type { ArticleType, PublishStatus, Visibility } from '../types.ts';

export type ProvenanceKind = 'table_confirmed' | 'dm_confirmed' | 'official_reference' | 'planned_unplayed' | 'transcript_uncertain';

/** Exactly what the loader read, row for row. The builder never queries anything. */
export interface ExportData {
  generatedAt: string;
  campaign: { title: string; tagline: string; overview: string; current_status: string } | null;
  articles: {
    id: string; slug: string; type: ArticleType; title: string; subtitle: string; summary: string;
    visibility: Visibility; status: PublishStatus; is_party_member: boolean; importance: number;
    session_date: string | null; source_ref: string; created_at: string; updated_at: string; published_at: string | null;
  }[];
  sections: { id: string; article_id: string; position: number; heading: string; body: string; visibility: Visibility; status: PublishStatus }[];
  fields: { id: string; article_id: string; position: number; label: string; value: string; visibility: Visibility }[];
  relations: { id: string; source_article_id: string; target_article_id: string; kind: string; label: string; visibility: Visibility; source_ref: string }[];
  categories: { id: string; slug: string; name: string; kind: string; description: string; visibility: Visibility }[];
  articleCategories: { article_id: string; category_id: string }[];
  redirects: { from_slug: string; article_id: string; visibility: Visibility }[];
  timeline: { id: string; title: string; date_label: string; sort_key: number | string | null; body: string; article_id: string | null; visibility: Visibility; status: PublishStatus }[];
  provenance: { id: string; article_id: string; section_id: string | null; field_id: string | null; kind: ProvenanceKind; reference: string }[];
  dmNotes: { id: string; article_id: string | null; title: string; body: string; created_at: string; updated_at: string }[];
  news: {
    article_id: string; section: string; reliability: string; reporter: string; dateline: string; in_world_date: string;
    issue_number: number | null; review_state: string; corrects_article_id: string | null;
  }[];
  maps: { id: string; slug: string; title: string; description: string; article_id: string | null; parent_map_id: string | null; visibility: Visibility; status: PublishStatus }[];
  markers: { id: string; map_id: string; label: string; description: string; article_id: string | null; visibility: Visibility }[];
  mysteries: { id: string; title: string; player_title: string; summary: string; dm_notes: string; status: string }[];
  clues: {
    id: string; mystery_id: string; kind: string; title: string; body: string; source_line: string; attach_article_id: string | null;
    requires_clue_id: string | null; release_at: string | null; released_at: string | null; position: number;
  }[];
  hints: { id: string; clue_id: string; position: number; body: string; release_at: string | null; released_at: string | null }[];
  /** Number of players who found each clue (no user ids). */
  discoveries: Record<string, number>;
  research: {
    collections: { id: string; title: string; description: string; shared: boolean }[];
    notes: { id: string; collection_id: string; title: string; body: string }[];
    sources: { id: string; collection_id: string; article_id: string | null; topic: string; annotation: string; excerpt: string; position: number }[];
  };
  tablesRead: string[];
}

export interface ExportOptions {
  /** DM-only and draft material. Off: only what players can read in the wiki. */
  dmSecrets: boolean;
  /** Material marked "planned, not yet played". */
  plans: boolean;
  /** DM notes, mystery notes and the DM's own Knowledge Studio research (none of it is classified). */
  dmNotes: boolean;
  /** Session journals and the timeline. */
  sessions: boolean;
  /** Saved connections between pages. */
  relationships: boolean;
  /** Address of the live site, for links back to each page. */
  siteUrl: string;
}

export const DEFAULT_OPTIONS: Omit<ExportOptions, 'siteUrl'> = { dmSecrets: true, plans: true, dmNotes: true, sessions: true, relationships: true };
