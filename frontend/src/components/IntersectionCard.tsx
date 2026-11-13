import React from 'react';
import { CongestionLevel, IntersectionSummary } from '../types/traffic';

interface IntersectionCardProps {
  intersection: IntersectionSummary;
  onSelect: (id: string) => void;
}

const STATUS_META: Record<
  CongestionLevel,
  { label: string; badgeClass: string; cardClass: string; description: string }
> = {
  fluido: {
    label: 'Tránsito Fluido',
    badgeClass: 'status-badge-green',
    cardClass: 'card-status-green',
    description: 'Circulación normal',
  },
  moderado: {
    label: 'Tránsito Moderado',
    badgeClass: 'status-badge-yellow',
    cardClass: 'card-status-yellow',
    description: 'Densidad media en calzada',
  },
  congestionado: {
    label: 'Congestionado',
    badgeClass: 'status-badge-red',
    cardClass: 'card-status-red',
    description: 'Alerta de saturación vehicular',
  },
};

export const IntersectionCard: React.FC<IntersectionCardProps> = ({
  intersection,
  onSelect,
}) => {
  const meta = STATUS_META[intersection.status];
  const occupancyPct = Math.min(
    100,
    Math.round((intersection.vehicleCount / intersection.maxCapacity) * 100)
  );

  return (
    <article
      className={`intersection-card ${meta.cardClass}`}
      onClick={() => onSelect(intersection.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(intersection.id);
        }
      }}
      data-testid={`intersection-card-${intersection.id}`}
    >
      <div className="card-header">
        <div className="camera-tag">
          <span className="camera-dot" />
          <span>{intersection.cameraCode}</span>
          <span className="zone-label">· {intersection.zone}</span>
        </div>
        <span className={`status-badge ${meta.badgeClass}`}>
          <span className="status-indicator-dot" />
          {meta.label}
        </span>
      </div>

      <h3 className="intersection-title">{intersection.name}</h3>

      <div className="vehicle-metrics-row">
        <div className="metric-primary">
          <span className="metric-value">{intersection.vehicleCount}</span>
          <span className="metric-unit">vehículos detectados</span>
        </div>
        <div className="metric-secondary">
          <span className="speed-value">{intersection.averageSpeedKmh} km/h</span>
          <span className="speed-label">vel. media</span>
        </div>
      </div>

      <div className="occupancy-bar-wrapper">
        <div className="occupancy-bar-labels">
          <span> saturación de vía ({occupancyPct}%)</span>
          <span>Cap. máx: {intersection.maxCapacity}</span>
        </div>
        <div className="occupancy-bar-track">
          <div
            className="occupancy-bar-fill"
            style={{ width: `${occupancyPct}%` }}
          />
        </div>
      </div>

      <div className="card-footer">
        <span className="timestamp-text">Actualizado: {intersection.lastUpdated}</span>
        <span className="card-cta">Ver análisis histórico →</span>
      </div>
    </article>
  );
};
