import { useDerby } from '../lib/derby.tsx';

export function Notices() {
  const { notices, dismiss, connected, state } = useDerby();
  return (
    <div className="notices">
      {!connected && state && <div className="notice notice-warn">Reconnecting to the race server…</div>}
      {notices.map((n) => (
        <div key={n.id} className={`notice notice-${n.level}`} onClick={() => dismiss(n.id)}>
          {n.message}
        </div>
      ))}
    </div>
  );
}
