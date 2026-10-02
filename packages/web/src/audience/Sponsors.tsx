import { useEffect, useState } from 'react';
import type { Sponsor } from '@derby/core';
import { useDerby } from '../lib/derby.tsx';
import { brandingUrl } from '../lib/branding.ts';

/** One sponsor, big: their logo on a white card with the name under it. */
export function SponsorCard({ sponsor, kicker }: { sponsor: Sponsor; kicker?: string }) {
  return (
    <div className="aud-sponsor">
      {kicker && <div className="aud-kicker">{kicker}</div>}
      {sponsor.image && <img className="aud-sponsor-image" src={brandingUrl(sponsor.image)} alt="" />}
      <div className="aud-sponsor-name">{sponsor.name}</div>
    </div>
  );
}

const PER_PAGE = 6;
const PAGE_MS = 8000;

/** The intermission screen: pack logo and every sponsor, six at a time. */
export function SponsorsView() {
  const { state } = useDerby();
  const [page, setPage] = useState(0);
  const sponsors = state?.branding.sponsors ?? [];
  const pages = Math.max(1, Math.ceil(sponsors.length / PER_PAGE));
  useEffect(() => {
    if (pages < 2) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pages), PAGE_MS);
    return () => clearInterval(id);
  }, [pages]);
  if (!state) return null;
  const shown = sponsors.slice((page % pages) * PER_PAGE, (page % pages) * PER_PAGE + PER_PAGE);
  return (
    <div className="aud-sponsors">
      <div className="aud-sponsors-head">
        {state.branding.logo && <img className="aud-logo" src={brandingUrl(state.branding.logo)} alt="" />}
        <div className="aud-kicker">{state.name}</div>
        <h1 className="aud-title">{sponsors.length ? 'Thank you to our sponsors' : 'Thank you'}</h1>
      </div>
      {sponsors.length > 0 && (
        <div className="aud-sponsors-grid" key={page}>
          {shown.map((s) => (
            <SponsorCard key={s.id} sponsor={s} />
          ))}
        </div>
      )}
    </div>
  );
}
