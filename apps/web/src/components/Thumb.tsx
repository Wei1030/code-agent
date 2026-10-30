/** Pictures in the chat: a thumbnail that opens full size on click. */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../lib/i18n';

/** Where the server serves a picture of a session's own folders (Markdown images, the file preview). */
export const sessionImageUrl = (sid: string, path: string) => `/files?sid=${encodeURIComponent(sid)}&path=${encodeURIComponent(path)}`;

/** An image source Claude wrote: a data URL or a web address as it is, a path through the server. */
export function imageSrc(src: string, sid?: string): string | null {
  if (/^data:image\//i.test(src) || /^https?:\/\//i.test(src)) return src;
  if (!sid) return null;
  return sessionImageUrl(sid, src.replace(/^file:\/\/\/?/i, ''));
}

export function Thumb({ src, alt }: { src: string; alt?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  if (broken) return <span className="thumb-broken" title={src}>{alt || t('图片')}</span>;
  return (
    <>
      <img className="thumb" src={src} alt={alt ?? ''} title={t('点击查看大图')} onClick={(e) => { e.stopPropagation(); setOpen(true); }} onError={() => setBroken(true)} />
      {open && createPortal(
        <div className="img-view" role="dialog" aria-label={alt || t('图片')} onClick={() => setOpen(false)}>
          <img src={src} alt={alt ?? ''} />
        </div>,
        document.body,
      )}
    </>
  );
}
