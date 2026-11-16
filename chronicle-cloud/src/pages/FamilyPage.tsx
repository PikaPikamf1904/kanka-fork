import { Link, useParams } from 'react-router';
import { FamilyTree } from '../components/FamilyTree.tsx';

/** The full family tree of one character, at /family/<slug>. */
export function FamilyPage() {
  const { slug = '' } = useParams();
  return (
    <div className="family-page">
      <nav className="breadcrumbs" aria-label="Breadcrumbs">
        <Link to="/browse/character">Characters</Link> › <Link to={`/wiki/${slug}`}>Back to the page</Link>
      </nav>
      <h1 className="page-title">Family tree</h1>
      <FamilyTree slug={slug} />
    </div>
  );
}
