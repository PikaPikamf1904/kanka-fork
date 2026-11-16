import { lazy, Suspense } from 'react';

// The Markdown parser is the heaviest part of the reading experience, so it is a separate chunk.
// It is prefetched as soon as the app shell renders (see Layout), so it is normally ready before
// any article arrives; until then nothing raw is shown.
const loadImpl = () => import('./MarkdownImpl.tsx');
const MarkdownImpl = lazy(loadImpl);

export function prefetchMarkdown() {
  void loadImpl();
}

export function Markdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<div className="prose prose-loading" aria-busy="true" />}>
      <MarkdownImpl text={text} />
    </Suspense>
  );
}
