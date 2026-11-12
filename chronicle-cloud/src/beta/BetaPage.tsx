import { Link } from 'react-router';
import { useIsDm } from '../lib/session.tsx';

/** What the beta site adds, and how to try each feature. */
export function BetaPage() {
  const isDm = useIsDm();
  return (
    <div className="beta-page">
      <h1 className="page-title">What’s in beta</h1>
      <p>
        These features are being tried out. They change nothing in the database: everything they show comes from the pages you can
        already read, and anything they remember stays on this device. If one is not useful, it can be removed without a trace.
      </p>
      <ol className="beta-list">
        <li>
          <h2>Quick jump</h2>
          <p>Press <kbd>Ctrl</kbd>+<kbd>K</kbd> (<kbd>⌘</kbd><kbd>K</kbd> on a Mac) or <kbd>/</kbd>, or tap <span aria-hidden="true">⤳</span> in the header. Type a few letters of any page, place or tool and press Enter.</p>
          <button type="button" className="button small" onClick={() => window.dispatchEvent(new Event('chronicle:quick-jump'))}>Try it</button>
        </li>
        <li>
          <h2>Link previews</h2>
          <p>Rest the mouse on a link inside an article (or Tab to it) to see the page’s picture, type and summary without leaving where you are. Phones and tablets simply follow the link.</p>
        </li>
        <li>
          <h2>Since your last visit</h2>
          <p>The main page lists the pages that are new or changed since you last opened Chronicle on this device. <strong>Mark all as seen</strong> clears the list.</p>
          <Link className="button small" to="/">See the main page</Link>
        </li>
        <li>
          <h2>Connections web</h2>
          <p>Connections can now be drawn as a web. Click a page to light up everyone it is connected to; drag to move, zoom with the buttons, the wheel or a pinch.</p>
          <Link className="button small" to="/connections">Open connections</Link>
        </li>
        {isDm && (
          <li>
            <h2>Table screen (DM)</h2>
            <p>Initiative tracker with hit points and conditions, a dice roller (advantage, disadvantage, <code>4d6kh3</code>), pinned pages for tonight’s NPCs and places, and table notes. Kept on this device only.</p>
            <Link className="button small" to="/dm/table">Open the table screen</Link>
          </li>
        )}
      </ol>
      <p className="fine-print">
        The beta site uses the same Chronicle data and the same sign-in as the main site. Player sign-up with an access code does not work
        here (the beta site has no server keys), so it is effectively a preview for the DM.
      </p>
    </div>
  );
}
