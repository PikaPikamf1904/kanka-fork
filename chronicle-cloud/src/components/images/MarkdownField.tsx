import '../../styles/images.css';
import { useRef, useState } from 'react';
import { getMediaByPath, type MediaItem } from '../../lib/api.ts';
import { findImages, insertImages, moveImage, replaceImage, type InlineImage } from '../../lib/mediaMarkdown.ts';
import { MediaImage } from '../MediaImage.tsx';
import { ImagePicker } from './ImagePicker.tsx';

/**
 * A Markdown text box with "Add photo" and "Add gallery". Pictures go in at the cursor (or at the
 * end), and each one in the text gets a card to edit its caption and description, adjust its crop,
 * move or remove it, so nobody has to write Markdown or addresses by hand.
 */
export function MarkdownField({ value, onChange, label, rows = 6, maxLength }: {
  value: string;
  onChange(text: string): void;
  label: string;
  rows?: number;
  maxLength?: number;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const cursor = useRef<number | null>(null);
  const [picking, setPicking] = useState<null | 'picture' | 'gallery'>(null);
  const [adjusting, setAdjusting] = useState<{ img: InlineImage; item: MediaItem } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const images = findImages(value);
  const remember = () => {
    cursor.current = box.current?.selectionStart ?? null;
  };
  return (
    <div className="markdown-field">
      <div className="markdown-tools" role="toolbar" aria-label={`${label}: pictures`}>
        <button type="button" className="button secondary small" onClick={() => setPicking('picture')}>🖼 Add photo</button>
        <button type="button" className="button secondary small" onClick={() => setPicking('gallery')}>Add gallery</button>
      </div>
      <textarea
        ref={box}
        aria-label={label}
        rows={rows}
        maxLength={maxLength}
        value={value}
        onChange={(e) => {
          remember();
          onChange(e.target.value);
        }}
        onSelect={remember}
        onKeyUp={remember}
        onClick={remember}
      />
      {images.length > 0 && (
        <ul className="inline-images" aria-label={`Pictures in ${label}`}>
          {images.map((img, i) => (
            <li key={`${img.path}-${img.start}`} className="inline-image">
              <MediaImage path={img.path} alt="" />
              <div className="inline-image-fields">
                <input aria-label={`Caption of picture ${i + 1}`} placeholder="Caption" value={img.caption} maxLength={300}
                  onChange={(e) => onChange(replaceImage(value, img, { alt: img.alt, caption: e.target.value }))} />
                <input aria-label={`Description of picture ${i + 1}`} placeholder="Description for screen readers" value={img.alt} maxLength={300}
                  onChange={(e) => onChange(replaceImage(value, img, { alt: e.target.value, caption: img.caption }))} />
              </div>
              <div className="inline-image-buttons">
                <button type="button" className="icon-button" aria-label={`Move picture ${i + 1} earlier`} disabled={i === 0} onClick={() => onChange(moveImage(value, i, -1))}>↑</button>
                <button type="button" className="icon-button" aria-label={`Move picture ${i + 1} later`} disabled={i === images.length - 1} onClick={() => onChange(moveImage(value, i, 1))}>↓</button>
                <button
                  type="button"
                  className="button secondary small"
                  aria-label={`Adjust picture ${i + 1}`}
                  onClick={async () => {
                    setProblem(null);
                    try {
                      const item = await getMediaByPath(img.path);
                      if (item) setAdjusting({ img, item });
                      else setProblem('That picture is no longer in the library.');
                    } catch (err) {
                      setProblem(err instanceof Error ? err.message : 'Could not open the picture.');
                    }
                  }}
                >
                  Adjust
                </button>
                <button type="button" className="icon-button" aria-label={`Remove picture ${i + 1}`} onClick={() => onChange(replaceImage(value, img, null))}>✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {problem && <p className="form-error" role="alert">{problem}</p>}
      {adjusting && (
        <ImagePicker
          purpose="picture"
          title="Adjust picture"
          start={adjusting.item}
          onCancel={() => setAdjusting(null)}
          onDone={(picked) => {
            const { img } = adjusting;
            setAdjusting(null);
            const media = picked[0]?.media;
            // The text may have changed meanwhile: find the same picture again by position and path.
            const now = findImages(value).find((x) => x.path === img.path && x.start === img.start) ?? findImages(value).find((x) => x.path === img.path);
            if (media && now) onChange(replaceImage(value, now, { alt: picked[0]!.alt || now.alt, caption: now.caption, path: media.path }));
          }}
        />
      )}
      {picking && (
        <ImagePicker
          purpose={picking}
          title={picking === 'gallery' ? 'Add a gallery' : 'Add a photo'}
          onCancel={() => setPicking(null)}
          onDone={(picked) => {
            setPicking(null);
            const r = insertImages(value, cursor.current ?? value.length, picked.map((p) => ({ path: p.media.path, alt: p.alt, caption: p.caption })), picking === 'gallery');
            cursor.current = r.cursor;
            onChange(r.text);
          }}
        />
      )}
    </div>
  );
}
