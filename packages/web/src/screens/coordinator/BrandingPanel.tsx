import { useRef, useState } from 'react';
import { useDerby } from '../../lib/derby.tsx';
import { brandingUrl, shrinkImage, uploadLogo, uploadSponsorImage } from '../../lib/branding.ts';

/** Pack logo and the sponsor list, on the coordinator's Audience tab. */
export function BrandingPanel() {
  const { state, run, notify } = useDerby();
  const logoRef = useRef<HTMLInputElement>(null);
  const sponsorRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [name, setName] = useState('');
  if (!state) return null;
  const { logo, sponsors } = state.branding;

  const send = async (file: File | undefined, upload: (blob: Blob) => Promise<unknown>) => {
    if (!file) return;
    try {
      await upload(await shrinkImage(file));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err));
    }
  };
  const add = async () => {
    if (!name.trim()) return;
    await run('addSponsor', { name });
    setName('');
  };
  const move = (index: number, delta: number) => {
    const ids = sponsors.map((s) => s.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id!);
    run('reorderSponsors', { ids });
  };

  return (
    <section className="panel">
      <h2>Pack logo and sponsors</h2>
      <p className="muted small">
        The logo goes on the welcome slide, the sponsor screen and the certificates. Sponsors get a thank-you card in the welcome rotation and their own screen for breaks. A PNG with a
        transparent background looks best.
      </p>
      <div className="brand-logo">
        {logo ? <img src={brandingUrl(logo)} alt="Pack logo" /> : <span className="muted small">No logo yet</span>}
        <div className="control-actions">
          <button className="btn btn-sm" onClick={() => logoRef.current?.click()}>
            {logo ? 'Replace logo' : 'Add logo'}
          </button>
          {logo && (
            <button className="btn btn-sm" onClick={() => run('clearLogo')}>
              Remove
            </button>
          )}
        </div>
        <input
          ref={logoRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            send(e.target.files?.[0], uploadLogo);
            e.target.value = '';
          }}
        />
      </div>
      {sponsors.length > 0 && (
        <ul className="sponsor-list">
          {sponsors.map((s, i) => (
            <li key={s.id}>
              <span className="sponsor-thumb">{s.image ? <img src={brandingUrl(s.image)} alt="" /> : <span>no image</span>}</span>
              <input defaultValue={s.name} aria-label="Sponsor name" onBlur={(e) => e.target.value.trim() !== s.name && run('updateSponsor', { id: s.id, name: e.target.value })} />
              <span className="sponsor-actions">
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setTarget(s.id);
                    sponsorRef.current?.click();
                  }}
                >
                  {s.image ? 'Replace image' : 'Add image'}
                </button>
                <button className="btn btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  ↑
                </button>
                <button className="btn btn-sm" onClick={() => move(i, 1)} disabled={i === sponsors.length - 1} aria-label="Move down">
                  ↓
                </button>
                <button className="btn btn-sm" onClick={() => confirm(`Remove ${s.name}?`) && run('removeSponsor', { id: s.id })} aria-label="Remove">
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="sponsor-add">
        <input value={name} placeholder="Sponsor name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn btn-sm" onClick={add} disabled={!name.trim()}>
          Add sponsor
        </button>
      </div>
      <input
        ref={sponsorRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          if (target) send(e.target.files?.[0], (blob) => uploadSponsorImage(target, blob));
          e.target.value = '';
        }}
      />
    </section>
  );
}
