import '../../styles/images.css';
import { useState } from 'react';
import { getMediaItem, type MediaItem } from '../../lib/api.ts';
import { MediaImage } from '../MediaImage.tsx';
import { ImagePicker, type Purpose } from './ImagePicker.tsx';

/**
 * One picture for a page, story or the main-page banner: Add, Change, Adjust (crop again) and
 * Remove. Removing only takes it off this page; the file stays in the media library.
 */
export function ImageField({ label, mediaId, purpose, onChange, hint, warning, testId }: {
  label: string;
  mediaId: string | null;
  purpose: Extract<Purpose, 'portrait' | 'landscape' | 'banner'>;
  onChange(id: string | null): void;
  hint?: string;
  /** Shown prominently, e.g. that every player sees the banner. */
  warning?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState<null | 'pick' | MediaItem>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`image-field image-field-${purpose}`} data-testid={testId}>
      <div className="image-field-preview">
        {mediaId ? <MediaImage id={mediaId} alt={`${label}: current picture`} /> : <span className="muted">No picture yet</span>}
      </div>
      <div className="image-field-side">
        <strong>{label}</strong>
        {hint && <span className="fine-print">{hint}</span>}
        {warning && <span className="image-warning" role="note">{warning}</span>}
        <div className="row-wrap">
          <button type="button" className="button small" onClick={() => setOpen('pick')}>{mediaId ? 'Change photo' : 'Add photo'}</button>
          {mediaId && (
            <button
              type="button"
              className="button secondary small"
              onClick={async () => {
                setError(null);
                try {
                  const item = await getMediaItem(mediaId);
                  if (item) setOpen(item);
                  else setError('That picture is no longer in the library.');
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not open the picture.');
                }
              }}
            >
              Adjust
            </button>
          )}
          {mediaId && <button type="button" className="button secondary small" onClick={() => onChange(null)}>Remove photo</button>}
        </div>
        {error && <span className="form-error" role="alert">{error}</span>}
      </div>
      {open && (
        <ImagePicker
          purpose={purpose}
          title={open === 'pick' ? (mediaId ? `Change ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`) : `Adjust ${label.toLowerCase()}`}
          start={open === 'pick' ? null : open}
          onCancel={() => setOpen(null)}
          onDone={(picked) => {
            setOpen(null);
            if (picked[0]) onChange(picked[0].media.id);
          }}
        />
      )}
    </div>
  );
}
