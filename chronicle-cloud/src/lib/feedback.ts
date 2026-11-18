// Feedback Center: named and anonymous submissions (players) and the DM's inbox.
import { supabase } from './supabase.ts';

export type FeedbackCategory = 'bug' | 'improvement' | 'feature' | 'enjoy' | 'more' | 'less' | 'confusing' | 'comfort' | 'other';
export type FeedbackStatus = 'new' | 'read' | 'in_progress' | 'done' | 'closed';
export type FeedbackPriority = 'none' | 'low' | 'normal' | 'high';

export const CATEGORIES: { value: FeedbackCategory; label: string; hint: string }[] = [
  { value: 'comfort', label: 'Boundaries or discomfort', hint: 'Something in the campaign that made you uncomfortable, or a line you would rather not cross.' },
  { value: 'enjoy', label: 'Something I enjoy', hint: 'Moments, characters or kinds of scenes you love.' },
  { value: 'more', label: 'I’d like more of…', hint: 'What you would like to see more often.' },
  { value: 'less', label: 'I’d like less of…', hint: 'What you would like to see less often.' },
  { value: 'confusing', label: 'Something confusing in the campaign', hint: 'A plot thread, rule or name that is hard to follow.' },
  { value: 'bug', label: 'Website problem', hint: 'Something on the website that is broken or behaves oddly.' },
  { value: 'improvement', label: 'Website improvement', hint: 'Something that works but could be easier or nicer.' },
  { value: 'feature', label: 'New website feature', hint: 'Something the website cannot do yet.' },
  { value: 'other', label: 'Something else', hint: 'Anything else you would like the DM to know.' },
];
export const categoryLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c;

export const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'New', read: 'Read', in_progress: 'Being worked on', done: 'Done', closed: 'Closed',
};

export interface MyFeedback {
  id: string;
  category: FeedbackCategory;
  body: string;
  submitted_on: string;
  status: FeedbackStatus;
  reply: string;
  replied_at: string | null;
}

export interface InboxItem extends MyFeedback {
  mode: 'named' | 'anonymous';
  author_name: string | null;
  priority: FeedbackPriority;
  dm_note: string;
}

const MISSING = new Set(['PGRST202', 'PGRST205', '42P01']);

/** Named feedback goes in as a normal row; the database signs it with the caller's own account. */
export async function sendFeedback(category: FeedbackCategory, body: string, anonymous: boolean): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error('Write something first.');
  if (anonymous) {
    const { error } = await supabase.rpc('submit_anonymous_feedback', { p_category: category, p_body: text });
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase.from('feedback').insert({ category, body: text, mode: 'named' });
  if (error) throw new Error(error.message);
}

/** The caller's own named feedback (anonymous submissions cannot be read back by anyone but the DM). */
export async function myFeedback(userId: string): Promise<MyFeedback[] | null> {
  const { data, error } = await supabase
    .from('feedback')
    .select('id, category, body, submitted_on, status, reply, replied_at')
    .eq('mode', 'named')
    .eq('author_id', userId)
    .order('submitted_on', { ascending: false })
    .limit(100);
  if (error && MISSING.has(error.code)) return null;
  if (error) throw new Error(error.message);
  return data as MyFeedback[];
}

export async function inbox(): Promise<InboxItem[] | null> {
  const { data, error } = await supabase
    .from('feedback')
    .select('id, category, body, mode, author_name, submitted_on, status, priority, dm_note, reply, replied_at')
    .order('submitted_on', { ascending: false })
    .limit(500);
  if (error && MISSING.has(error.code)) return null;
  if (error) throw new Error(error.message);
  return data as InboxItem[];
}

export async function triage(id: string, patch: Partial<Pick<InboxItem, 'status' | 'priority' | 'dm_note' | 'reply'>>): Promise<void> {
  const { error } = await supabase.from('feedback').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteFeedback(id: string): Promise<void> {
  const { error } = await supabase.from('feedback').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
