import { Link } from 'react-router';

/** Same message whether something is missing or hidden, so a 404 never confirms that a secret exists. */
export function NotFound({ what = 'page' }: { what?: string }) {
  return (
    <div className="not-found">
      <h1>Nothing written here yet</h1>
      <p>This {what} does not exist, or has not been revealed.</p>
      <p><Link to="/">Back to the main page</Link></p>
    </div>
  );
}
