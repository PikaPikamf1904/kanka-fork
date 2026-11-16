import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { wanderToSlug } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { TEMPLATES, TYPE_ORDER } from '../lib/templates.ts';
import { loadRecent, remember, saveRecent } from '../lib/wander.ts';
import type { ArticleType } from '../lib/types.ts';

/** /wander (optionally ?type=location): jumps to a random page this reader may read. */
export function WanderPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { playerPreview } = useSession();
  const asked = params.get('type');
  const type = TYPE_ORDER.includes(asked as ArticleType) ? (asked as ArticleType) : undefined;
  const [state, setState] = useState<'looking' | 'empty' | 'error'>('looking');

  useEffect(() => {
    let live = true;
    wanderToSlug({ type, readerView: playerPreview, recent: loadRecent() }).then(
      (slug) => {
        if (!live) return;
        if (!slug) return setState('empty');
        saveRecent(remember(loadRecent(), slug));
        navigate(`/wiki/${slug}`, { replace: true });
      },
      () => live && setState('error'),
    );
    return () => {
      live = false;
    };
  }, [type, playerPreview, navigate]);

  if (state === 'looking') return <p className="muted" role="status">Wandering…</p>;
  return (
    <div className="not-found">
      <h1>{state === 'empty' ? 'Nothing to wander to yet' : 'The path was lost'}</h1>
      <p>
        {state === 'empty'
          ? type ? `There are no ${TEMPLATES[type].plural.toLowerCase()} you can read yet.` : 'There are no pages you can read yet.'
          : 'Could not pick a page. Check your connection and try again.'}
      </p>
      <p>
        {state === 'error' && <><Link to={type ? `/wander?type=${type}` : '/wander'} reloadDocument>Try again</Link> · </>}
        {type && <><Link to="/wander">Wander anywhere</Link> · </>}
        <Link to="/">Back to the main page</Link>
      </p>
    </div>
  );
}
