/**
 * Reveal — an identifier that shows masked, and in clear only while held.
 *
 * Re-masks on pointer-up, pointer-leave, key-up AND blur (doc 141 §8): a
 * keyboard never produces the first, and a window switch never produces the
 * second, so a single exit would leave the value on screen.
 */
import { useState } from 'react';
import { useI18n } from '../i18n/useI18n';

export function Reveal({ value, masked }: { value: string; masked: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const hide = () => setOpen(false);
  return (
    <button
      type="button"
      className={`bw-reveal${open ? ' is-open' : ''}`}
      title={t('profile.holdToReveal')}
      aria-label={t('profile.holdToReveal')}
      onPointerDown={() => setOpen(true)}
      onPointerUp={hide}
      onPointerLeave={hide}
      onPointerCancel={hide}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setOpen(true); }}
      onKeyUp={hide}
      onBlur={hide}
    >
      {open ? value : masked}
    </button>
  );
}
