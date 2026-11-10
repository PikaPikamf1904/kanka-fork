export type Visibility = 'players' | 'dm';
export type PublishStatus = 'draft' | 'published';
export type ArticleType =
  | 'lore' | 'character' | 'location' | 'faction' | 'item' | 'quest' | 'session' | 'event' | 'dossier';

export interface Article {
  id: string;
  slug: string;
  type: ArticleType;
  title: string;
  subtitle: string;
  summary: string;
  hero_media_id: string | null;
  visibility: Visibility;
  status: PublishStatus;
  is_featured: boolean;
  is_party_member: boolean;
  importance: number;
  session_date: string | null;
  updated_at: string;
  published_at: string | null;
  /** Goes up by one on every change to the article or its parts. */
  version: number;
}

export interface Section {
  id: string;
  article_id: string;
  position: number;
  heading: string;
  body: string;
  visibility: Visibility;
  status: PublishStatus;
}

export interface InfoboxField {
  id: string;
  article_id: string;
  position: number;
  label: string;
  value: string;
  visibility: Visibility;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  kind: 'category' | 'tag';
  description: string;
  visibility: Visibility;
}

export interface CategoryCount {
  id: string;
  slug: string;
  name: string;
  kind: 'category' | 'tag';
  description: string;
  article_count: number;
}

export interface Relation {
  id: string;
  source_article_id: string;
  target_article_id: string;
  kind: string;
  label: string;
  visibility: Visibility;
}

export interface ArticleRef {
  slug: string;
  title: string;
  type: ArticleType;
}

export interface Media {
  id: string;
  path: string;
  alt: string;
  width: number | null;
  height: number | null;
  visibility: Visibility;
}

export interface TimelineEvent {
  id: string;
  title: string;
  date_label: string;
  sort_key: number;
  body: string;
  article_id: string | null;
  visibility: Visibility;
  status: PublishStatus;
}

export interface WikiMap {
  id: string;
  slug: string;
  title: string;
  description: string;
  media_id: string | null;
  width: number;
  height: number;
  parent_map_id: string | null;
  article_id: string | null;
  visibility: Visibility;
  status: PublishStatus;
}

export interface MapMarker {
  id: string;
  map_id: string;
  x: number;
  y: number;
  label: string;
  description: string;
  icon: string;
  article_id: string | null;
  visibility: Visibility;
}

export interface DmNote {
  id: string;
  article_id: string | null;
  title: string;
  body: string;
  updated_at: string;
}

export interface Revision {
  id: string;
  article_id: string;
  note: string;
  created_at: string;
}

export interface CampaignSettings {
  title: string;
  tagline: string;
  overview: string;
  banner_media_id: string | null;
}

export interface Member {
  user_id: string;
  role: 'player' | 'dm';
  display_name: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export interface AccessCode {
  id: string;
  label: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  max_uses: number | null;
  use_count: number;
}

export interface SearchHit {
  article_id: string;
  slug: string;
  title: string;
  type: ArticleType;
  summary: string;
  snippet: string | null;
  rank: number;
}
