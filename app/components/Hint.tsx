// A one-line explanation beside a number: an "i" button whose text shows on hover, on keyboard focus and on tap (focus),
// in the Sinho tooltip style. Plain CSS, so it renders on the server and needs no script; the text is also the
// button's description for screen readers.
import { useId } from 'react';

export function Hint({ text, label }: { text: string; label: string }) {
  const id = useId();
  return (
    <span className="mf-hint">
      <button type="button" className="mf-hint__btn" aria-label={label} aria-describedby={id}>i</button>
      <span role="tooltip" id={id} className="sn-tip mf-hint__tip">{text}</span>
    </span>
  );
}
