import { useEffect, useState } from 'react';
import { fetchClipsPerMinuteFromBff } from '../services/bffApi';

/** Panel chico: clips procesados en el último minuto cerrado (Metrics DB), refresco cada 15 s. */
export default function ClipsPerMinutePill() {
  const [clips, setClips] = useState<number | null>(null);
  const [minute, setMinute] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const data = await fetchClipsPerMinuteFromBff(15);
      if (!active) return;
      const last = data?.timeSeries?.[data.timeSeries.length - 1];
      setClips(data?.lastClipsPerMinute ?? null);
      setMinute(last?.time ?? null);
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <span
      className="sys-stat-pill"
      id="pill-clips-per-minute"
      title="Clips procesados por minuto según la Metrics DB (monitoring-pipeline). Último minuto cerrado."
    >
      Clips/min <strong>{clips ?? '—'}</strong>
      {minute ? ` · ${minute}` : ''}
    </span>
  );
}
