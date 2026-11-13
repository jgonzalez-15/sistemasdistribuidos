import React, { useState } from 'react';
import { TimeSeriesPoint } from '../types/traffic';

interface TrafficLineChartProps {
  data: TimeSeriesPoint[];
  maxCapacity: number;
}

export const TrafficLineChart: React.FC<TrafficLineChartProps> = ({
  data,
  maxCapacity,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return <div className="chart-empty">Sin datos históricos disponibles</div>;
  }

  const width = 820;
  const height = 310;
  const padLeft = 52;
  const padRight = 28;
  const padTop = 26;
  const padBottom = 42;

  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const rawMax = Math.max(
    maxCapacity,
    ...data.map((d) => d.vehicles),
    120
  );
  const maxY = Math.ceil(rawMax / 30) * 30;

  const getX = (index: number) =>
    padLeft + (index / Math.max(1, data.length - 1)) * plotWidth;

  const getY = (value: number) =>
    padTop + plotHeight - (Math.min(Math.max(value, 0), maxY) / maxY) * plotHeight;

  const pointsString = data
    .map((pt, idx) => `${getX(idx).toFixed(1)},${getY(pt.vehicles).toFixed(1)}`)
    .join(' ');

  const areaPath = `M ${getX(0).toFixed(1)},${(padTop + plotHeight).toFixed(1)} L ${data
    .map((pt, idx) => `${getX(idx).toFixed(1)},${getY(pt.vehicles).toFixed(1)}`)
    .join(' L ')} L ${getX(data.length - 1).toFixed(1)},${(padTop + plotHeight).toFixed(
    1
  )} Z`;

  const yCongestion = getY(75);
  const yModerate = getY(40);

  const yTicks = Array.from({ length: maxY / 30 + 1 }, (_, idx) => idx * 30);

  const effectiveHoveredIndex =
    hoveredIndex !== null ? Math.min(hoveredIndex, data.length - 1) : data.length - 1;
  const activePoint = data[effectiveHoveredIndex] || data[data.length - 1];

  return (
    <div className="traffic-chart-container">
      <div className="chart-top-bar">
        <div className="chart-legend">
          <span className="legend-item">
            <span className="legend-line blue" /> Volumen Vehicular (vehículos / hora)
          </span>
          <span className="legend-item">
            <span className="legend-line red-dashed" /> Umbral Congestión (≥ 75 veh.)
          </span>
          <span className="legend-item">
            <span className="legend-line yellow-dashed" /> Umbral Moderado (≥ 40 veh.)
          </span>
        </div>

        {activePoint && (
          <div className="chart-live-tooltip">
            <span className="tooltip-hour">Hora {activePoint.hour}:</span>
            <strong
              className={`tooltip-count ${
                activePoint.vehicles >= 75
                  ? 'text-red'
                  : activePoint.vehicles >= 40
                  ? 'text-yellow'
                  : 'text-green'
              }`}
            >
              {activePoint.vehicles} vehículos
            </strong>
          </div>
        )}
      </div>

      <div className="svg-responsive-wrapper">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="traffic-line-svg"
          role="img"
          aria-label="Gráfico bidimensional de líneas de evolución vehicular por hora"
        >
          <defs>
            <linearGradient id="trafficAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid Lines & Y Axis Labels */}
          {yTicks.map((tick) => {
            const y = getY(tick);
            return (
              <g key={tick}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="rgba(148, 163, 184, 0.14)"
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 10}
                  y={y + 4}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="11"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Threshold Line: Congestion (75) */}
          <line
            x1={padLeft}
            y1={yCongestion}
            x2={width - padRight}
            y2={yCongestion}
            stroke="#ef4444"
            strokeWidth="1.5"
            strokeDasharray="6 4"
          />
          <text
            x={width - padRight - 4}
            y={yCongestion - 6}
            textAnchor="end"
            fill="#fca5a5"
            fontSize="10"
            fontWeight="600"
          >
            Umbral Crítico (75)
          </text>

          {/* Threshold Line: Moderate (40) */}
          <line
            x1={padLeft}
            y1={yModerate}
            x2={width - padRight}
            y2={yModerate}
            stroke="#f59e0b"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />

          {/* Area under the curve */}
          <path d={areaPath} fill="url(#trafficAreaGrad)" />

          {/* Main 2D Line */}
          <polyline
            fill="none"
            stroke="#38bdf8"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={pointsString}
          />

          {/* Data Points & X Axis Labels */}
          {data.map((pt, idx) => {
            const cx = getX(idx);
            const cy = getY(pt.vehicles);
            const isHovered = effectiveHoveredIndex === idx;
            const dotColor =
              pt.vehicles >= 75
                ? '#ef4444'
                : pt.vehicles >= 40
                ? '#f59e0b'
                : '#10b981';

            return (
              <g
                key={`point-${idx}`}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{ cursor: 'pointer' }}
              >
                {isHovered && (
                  <line
                    x1={cx}
                    y1={padTop}
                    x2={cx}
                    y2={padTop + plotHeight}
                    stroke="rgba(56, 189, 248, 0.35)"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                )}

                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 6.5 : 4.5}
                  fill={dotColor}
                  stroke="#0f172a"
                  strokeWidth="2"
                />

                {/* Value label above each point */}
                <text
                  x={cx}
                  y={cy - 10}
                  textAnchor="middle"
                  fill={isHovered ? '#f8fafc' : '#cbd5e1'}
                  fontSize={isHovered ? '11.5' : '10'}
                  fontWeight={isHovered ? '700' : '500'}
                >
                  {pt.vehicles}
                </text>

                {/* X Axis Hour Label */}
                <text
                  x={cx}
                  y={height - 14}
                  textAnchor="middle"
                  fill={isHovered ? '#38bdf8' : '#94a3b8'}
                  fontSize={data.length > 10 ? '10' : '11'}
                  fontWeight={isHovered ? '700' : '500'}
                >
                  {pt.hour}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
