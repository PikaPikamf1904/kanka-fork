import { ScratchpadEditor } from '../components/Scratchpad.tsx';

/** The general scratchpad: one note that is not tied to any page. */
export function ScratchpadPage() {
  return (
    <div className="scratchpad-page">
      <h1 className="page-title">My scratchpad</h1>
      <p className="muted">A place for quick thoughts that do not belong to one page. Each page also has its own scratchpad at the bottom.</p>
      <div className="panel">
        <ScratchpadEditor articleId={null} />
      </div>
    </div>
  );
}
