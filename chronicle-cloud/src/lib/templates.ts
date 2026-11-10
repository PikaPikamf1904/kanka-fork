import type { ArticleType, Visibility } from './types.ts';

export interface TemplateField {
  label: string;
  visibility?: Visibility;
}

export interface Template {
  type: ArticleType;
  label: string;
  plural: string;
  /** Glyph used for crests and markers; plain text, no external icon font. */
  glyph: string;
  infobox: TemplateField[];
  sections: { heading: string; visibility?: Visibility }[];
  /** Dossiers and other planning documents start DM-only. Everything starts as a draft. */
  defaultVisibility: Visibility;
}

export const TEMPLATES: Record<ArticleType, Template> = {
  character: {
    type: 'character', label: 'Character', plural: 'Characters', glyph: '♞',
    infobox: [
      { label: 'Race' }, { label: 'Affiliation' }, { label: 'Occupation' }, { label: 'Status' },
      { label: 'Location' }, { label: 'True identity', visibility: 'dm' }, { label: 'Hidden motivation', visibility: 'dm' },
    ],
    sections: [
      { heading: 'Appearance' }, { heading: 'Personality' }, { heading: 'Known history' },
      { heading: 'Notable appearances' }, { heading: 'Secrets', visibility: 'dm' },
    ],
    defaultVisibility: 'players',
  },
  location: {
    type: 'location', label: 'Location', plural: 'Locations', glyph: '⛫',
    infobox: [{ label: 'Region' }, { label: 'Ruler' }, { label: 'Population' }, { label: 'Notable factions' }],
    sections: [
      { heading: 'Description' }, { heading: 'History' }, { heading: 'Landmarks' },
      { heading: 'Known events' }, { heading: 'Hidden places', visibility: 'dm' },
    ],
    defaultVisibility: 'players',
  },
  faction: {
    type: 'faction', label: 'Faction', plural: 'Factions', glyph: '⚑',
    infobox: [
      { label: 'Leadership' }, { label: 'Headquarters' }, { label: 'Ideology' }, { label: 'Allies' },
      { label: 'Enemies' }, { label: 'True aims', visibility: 'dm' },
    ],
    sections: [{ heading: 'Overview' }, { heading: 'Members' }, { heading: 'Known activities' }, { heading: 'Schemes', visibility: 'dm' }],
    defaultVisibility: 'players',
  },
  item: {
    type: 'item', label: 'Item', plural: 'Items', glyph: '⚔',
    infobox: [{ label: 'Item type' }, { label: 'Owner' }, { label: 'Discovered' }, { label: 'True power', visibility: 'dm' }],
    sections: [{ heading: 'Description' }, { heading: 'Known properties' }, { heading: 'History' }],
    defaultVisibility: 'players',
  },
  quest: {
    type: 'quest', label: 'Quest', plural: 'Quests', glyph: '✦',
    infobox: [{ label: 'Status' }, { label: 'Given by' }, { label: 'Objective' }, { label: 'Reward' }],
    sections: [
      { heading: 'Objective' }, { heading: 'Known clues' }, { heading: 'Milestones' }, { heading: 'Outcome' },
      { heading: 'What is really going on', visibility: 'dm' },
    ],
    defaultVisibility: 'players',
  },
  session: {
    type: 'session', label: 'Session journal', plural: 'Session journals', glyph: '✎',
    infobox: [{ label: 'Session' }, { label: 'In-game date' }, { label: 'Party present' }],
    sections: [
      { heading: 'Recap' }, { heading: 'Locations visited' }, { heading: 'Characters encountered' },
      { heading: 'Discoveries' }, { heading: 'Open questions' }, { heading: 'DM notes for next time', visibility: 'dm' },
    ],
    defaultVisibility: 'players',
  },
  event: {
    type: 'event', label: 'Event', plural: 'Events', glyph: '☄',
    infobox: [{ label: 'When' }, { label: 'Where' }, { label: 'Involved' }],
    sections: [{ heading: 'What happened' }, { heading: 'Consequences' }],
    defaultVisibility: 'players',
  },
  dossier: {
    type: 'dossier', label: 'Dossier', plural: 'Dossiers', glyph: '⌖',
    infobox: [{ label: 'Subject' }, { label: 'Classification' }, { label: 'Handler' }, { label: 'Last updated' }],
    sections: [
      { heading: 'Summary' }, { heading: 'Known clues' }, { heading: 'Evidence' }, { heading: 'Leads' },
      { heading: 'Approaches' }, { heading: 'After-action report' },
    ],
    defaultVisibility: 'dm',
  },
  lore: {
    type: 'lore', label: 'Lore', plural: 'Lore', glyph: '❦',
    infobox: [],
    sections: [{ heading: 'Overview' }],
    defaultVisibility: 'players',
  },
};

export const TYPE_ORDER: ArticleType[] = ['character', 'location', 'faction', 'item', 'quest', 'session', 'event', 'lore', 'dossier'];

export const RELATION_KINDS: { kind: string; label: string }[] = [
  { kind: 'member_of', label: 'Member of' },
  { kind: 'knows', label: 'Knows' },
  { kind: 'ally_of', label: 'Ally of' },
  { kind: 'opposes', label: 'Opposes' },
  { kind: 'resides_in', label: 'Resides in' },
  { kind: 'owns', label: 'Owns' },
  { kind: 'involves', label: 'Involves' },
  { kind: 'appeared_in', label: 'Appeared in' },
  { kind: 'controls', label: 'Controls' },
  { kind: 'related_to', label: 'Related to' },
];

export function relationLabel(kind: string): string {
  return RELATION_KINDS.find((r) => r.kind === kind)?.label ?? kind.replace(/_/g, ' ');
}
