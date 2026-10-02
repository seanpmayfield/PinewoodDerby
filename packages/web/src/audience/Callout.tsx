/**
 * The big call to the scouts: NOW STAGING / NEXT UP. Designed to be read by a
 * seven-year-old running past the projector.
 */
export function Callout({ main, tag, sub, tone = 'stage' }: { main: string; tag?: string; sub: string; tone?: 'stage' | 'armed' }) {
  return (
    <div className={`aud-callout tone-${tone}`}>
      <div className="aud-callout-band">
        <span className="aud-callout-main">{main}</span>
        {tag && <span className="aud-callout-tag">{tag}</span>}
      </div>
      <div className="aud-callout-sub">{sub}</div>
    </div>
  );
}
