import type { Car } from '@derby/core';
import { carImage } from '../lib/format.ts';
import { SIDE } from '../pit/geometry.ts';

/**
 * A car picture when we have one (the background-removed cutout if it exists),
 * otherwise a stylised silhouette carrying the car number, drawn at the real
 * car's proportions in the standard side frame.
 */
export function CarPortrait({ car, color = '#ff3b1f', className = '' }: { car: Car | undefined; color?: string; className?: string }) {
  const image = car ? carImage(car) : null;
  if (image) {
    return <img className={`aud-portrait ${image.cutout ? 'is-cutout' : ''} ${className}`} src={image.url} alt={`Car ${car!.number}`} />;
  }
  const number = car?.number ?? '';
  const b = SIDE.block;
  const nose = b.x + 40;
  const tail = b.x + b.w - 40;
  const bottom = b.y + b.h;
  const body = `M${nose} ${bottom} L${nose} ${bottom - b.h * 0.35} Q${nose + b.w * 0.35} ${b.y + 4} ${tail - 30} ${b.y + b.h * 0.12} L${tail} ${bottom} Z`;
  const wheels = [SIDE.left, SIDE.right];
  return (
    <svg className={`aud-portrait aud-portrait-svg ${className}`} viewBox={`0 0 ${SIDE.width} ${SIDE.height}`} aria-label={`Car ${number}`}>
      <defs>
        <linearGradient id={`carBody-${number}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <path d={body} fill={color} />
      <path d={body} fill={`url(#carBody-${number})`} />
      <rect x={nose - 6} y={bottom - 6} width={tail - nose + 12} height={34} rx={12} fill="#1b1b20" />
      {wheels.map((w) => (
        <g key={w.cx}>
          <circle cx={w.cx} cy={w.cy} r={w.r} fill="#0d0d10" stroke="#3a3a42" strokeWidth={w.r * 0.22} />
          <circle cx={w.cx} cy={w.cy} r={w.r * 0.24} fill="#8a8a95" />
        </g>
      ))}
      <text x={SIDE.width / 2} y={bottom - b.h * 0.25} textAnchor="middle" fontFamily="Bahnschrift, 'Arial Black', sans-serif" fontWeight="800" fontSize={b.h * 0.9} fill="#fff" stroke="#000" strokeWidth="6" paintOrder="stroke">
        {number}
      </text>
    </svg>
  );
}
