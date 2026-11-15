import React, { useEffect, useRef, useState } from 'react';
import { TimeSeriesPoint } from '../types/traffic';

interface TrafficLineChartProps {
  data: TimeSeriesPoint[];
  maxCapacity: number;
}

const HEIGHT = 232;
const PAD = { left: 34, right: 52, top: 14, bottom: 26 };

function colorForValue(v: number): string {
  if (v >= 75) return '#EF4444';
  if (v >= 40) return '#F59E0B';
  return '#10B981';
}

export const TrafficLineChart: React.FC<TrafficLineChartProps> = ({ data, maxCapacity }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(600);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Use real pixel width as viewBox so mono labels render at a true 11px
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(Math.max(320, Math.round(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!data || data.length === 0) {
    return <div className="chart-empty">SIN DATOS HISTÓRICOS</div>;
  }

  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const rawMax = Math.max(maxCapacity, ...data.map((d) => d.vehicles), 120);
  const maxY = Math.ceil(rawMax / 30) * 30;
  const yTicks = Array.from({ length: maxY / 30 + 1 }, (_, i) => i * 30);

  const getX = (i: number) => PAD.left + (i / Math.max(1, data.length - 1)) * plotW;
  const getY = (v: number) => PAD.top + plotH - (Math.min(Math.max(v, 0), maxY) / maxY) * plotH;

  const linePath = data
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${getX(i).toFixed(1)},${getY(pt.vehicles).toFixed(1)}`)
    .join(' ');
  const baseY = (PAD.top + plotH).toFixed(1);
  const areaPath = `${linePath} L${getX(data.length - 1).toFixed(1)},${baseY} L${getX(0).toFixed(1)},${baseY} Z`;

  const spacing = plotW / Math.max(1, data.length - 1);
  const labelStep = Math.max(1, Math.ceil(64 / spacing));
  const lastIdx = data.length - 1;

  const activeIdx = hoveredIndex !== null ? Math.min(hoveredIndex, lastIdx) : null;
  const activePoint = activeIdx !== null ? data[activeIdx] : null;
  const lastPoint = data[lastIdx];

  const handleMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.round(((x - PAD.left) / plotW) * lastIdx);
    setHoveredIndex(Math.max(0, Math.min(lastIdx, idx)));
  };

  const thresholds = [
    { value: 75, label: 'CRIT 75' },
    { value: 40, label: 'MOD 40' },
  ];

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        height={HEIGHT}
        role="img"
        aria-label="Evolución temporal del volumen vehicular"
      >
        <defs>
          <linearGradient id="tmAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={getY(t)}
              y2={getY(t)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text x={PAD.left - 8} y={getY(t) + 3.5} textAnchor="end" fill="var(--text-tertiary)" fontSize="11">
              {t}
            </text>
          </g>
        ))}

        {thresholds.map((th) => (
          <g key={th.value}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={getY(th.value)}
              y2={getY(th.value)}
              stroke="var(--border-strong)"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            <text x={width - PAD.right + 6} y={getY(th.value) + 3.5} fill="var(--text-tertiary)" fontSize="9.5">
              {th.label}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#tmAreaGrad)" />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />

        {data.map((pt, i) =>
          i % labelStep === 0 || i === lastIdx ? (
            (i !== lastIdx && lastIdx - i < labelStep) ? null : (
              <text
                key={`x-${i}`}
                x={getX(i)}
                y={HEIGHT - 6}
                textAnchor={i === 0 ? 'start' : i === lastIdx ? 'end' : 'middle'}
                fill={i === activeIdx ? 'var(--text-primary)' : 'var(--text-tertiary)'}
                fontSize="11"
              >
                {pt.hour}
              </text>
            )
          ) : null
        )}

        {/* Last known point */}
        <circle cx={getX(lastIdx)} cy={getY(lastPoint.vehicles)} r="6" fill={colorForValue(lastPoint.vehicles)} opacity="0.18" />
        <circle
          cx={getX(lastIdx)}
          cy={getY(lastPoint.vehicles)}
          r="3"
          fill={colorForValue(lastPoint.vehicles)}
          stroke="var(--canvas)"
          strokeWidth="1.5"
        />

        {activePoint && activeIdx !== null && (
          <g pointerEvents="none">
            <line
              x1={getX(activeIdx)}
              x2={getX(activeIdx)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--border-strong)"
              strokeWidth="1"
            />
            <circle
              cx={getX(activeIdx)}
              cy={getY(activePoint.vehicles)}
              r="3.5"
              fill="var(--canvas)"
              stroke={colorForValue(activePoint.vehicles)}
              strokeWidth="1.75"
            />
          </g>
        )}

        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoveredIndex(null)}
          style={{ cursor: 'crosshair' }}
        />
      </svg>

      {activePoint && activeIdx !== null && (
        <div
          className="chart-tooltip"
          style={{
            left: `${(getX(activeIdx) / width) * 100}%`,
            top: getY(activePoint.vehicles),
          }}
        >
          <div className="chart-tooltip-time">{activePoint.hour} HS</div>
          <div className="chart-tooltip-value">
            <span className="status-dot" style={{ background: colorForValue(activePoint.vehicles) }} />
            {activePoint.vehicles} <small>VEH</small>
          </div>
        </div>
      )}

      <div className="chart-legend">
        <span>
          <i className="legend-swatch" /> VEH VISIBLES (MEDIANA/CLIP)
        </span>
        <span>
          <i className="legend-swatch dashed" /> UMBRALES 75 · 40
        </span>
      </div>
    </div>
  );
};
