import { useEffect, useMemo, useState } from 'react';
import type { Car, Sponsor } from '@derby/core';
import { useDerby } from '../lib/derby.tsx';
import { carImage, carInfo, laneColor } from '../lib/format.ts';
import { CarPortrait } from './CarPortrait.tsx';
import { SponsorCard } from './Sponsors.tsx';

/** How long each slide is up. */
const DWELL_MS = 4500;
/** Cars between sponsor cards. */
const CARS_PER_SPONSOR = 4;

type Slide = { kind: 'car'; car: Car } | { kind: 'sponsor'; sponsor: Sponsor };

/**
 * The cars, one at a time, on the welcome slide, with a sponsor's card every
 * few cars. Every side photo is in the same frame at the same pixels per
 * inch, so the cars appear at one scale; a car with no photo yet shows the
 * stock silhouette with its number. Roster and photo changes arrive over the
 * live connection and show at once.
 */
export function CarCarousel() {
  const { state } = useDerby();
  const slides = useMemo<Slide[]>(() => {
    if (!state) return [];
    const cars = [...state.cars].filter((c) => !c.withdrawn).sort((a, b) => a.number - b.number);
    const sponsors = state.branding.sponsors;
    const out: Slide[] = [];
    let next = 0;
    cars.forEach((car, i) => {
      out.push({ kind: 'car', car });
      if (sponsors.length && (i + 1) % CARS_PER_SPONSOR === 0) out.push({ kind: 'sponsor', sponsor: sponsors[next++ % sponsors.length]! });
    });
    return out;
  }, [state]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (slides.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % slides.length), DWELL_MS);
    return () => clearInterval(id);
  }, [slides.length]);
  if (!state || slides.length === 0) return null;
  const slide = slides[index % slides.length]!;
  const dots = slides.length > 1 && slides.length <= 48 && (
    <div className="aud-carousel-dots" aria-hidden>
      {slides.map((s, i) => (
        <span key={s.kind === 'car' ? s.car.id : `s-${i}`} className={i === index % slides.length ? 'is-on' : ''} />
      ))}
    </div>
  );
  if (slide.kind === 'sponsor') {
    return (
      <div className="aud-carousel is-sponsor" key={`s-${index}`}>
        <SponsorCard sponsor={slide.sponsor} kicker="Thank you to our sponsor" />
        {dots}
      </div>
    );
  }
  const car = slide.car;
  const info = carInfo(state, car.id);
  const hasPhoto = !!carImage(car);
  return (
    <div className="aud-carousel" key={car.id}>
      <div className="aud-carousel-stage">
        <CarPortrait car={car} color={laneColor(((car.number - 1) % 8) + 1)} />
      </div>
      <div className="aud-carousel-caption">
        <div className="aud-car-name">{car.name || `Car #${car.number}`}</div>
        <div className="aud-racer">{info?.racerName}</div>
        <div className="aud-meta">
          <span>#{car.number}</span>
          {info?.groupName && <span>{info.groupName}</span>}
          {!hasPhoto && <span className="aud-carousel-soon">Photo coming at check-in</span>}
        </div>
      </div>
      {dots}
    </div>
  );
}
