import { useEffect, useRef } from 'react';

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  rot: number;
  vr: number;
  w: number;
  h: number;
}

const COLORS = ['#ff3b1f', '#00d4ff', '#ffd60a', '#ffffff', '#30e07a', '#ff6ad5'];

/** Lightweight canvas confetti. `burst` changes trigger a new shower. */
export function Confetti({ burst, intensity = 1 }: { burst: number; intensity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pieces = useRef<Piece[]>([]);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (burst === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = (canvas.width = canvas.clientWidth);
    const height = (canvas.height = canvas.clientHeight);
    const count = Math.round(160 * intensity);
    for (let i = 0; i < count; i++) {
      const fromLeft = i % 2 === 0;
      pieces.current.push({
        x: fromLeft ? -10 : width + 10,
        y: height * (0.45 + Math.random() * 0.35),
        vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 9),
        vy: -(9 + Math.random() * 9),
        r: 0,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        w: 6 + Math.random() * 8,
        h: 4 + Math.random() * 6,
      });
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    cancelAnimationFrame(raf.current);
    const step = () => {
      ctx.clearRect(0, 0, width, height);
      pieces.current = pieces.current.filter((p) => p.y < height + 20);
      for (const p of pieces.current) {
        p.vy += 0.35;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (pieces.current.length > 0) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [burst, intensity]);

  return <canvas ref={canvasRef} className="aud-confetti" />;
}
