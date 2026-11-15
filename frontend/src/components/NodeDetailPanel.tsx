import React, { useEffect, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { IntersectionAnalyticsDetail, TrafficPatternType } from '../types/traffic';
import { fetchIntersectionAnalyticsFromBff } from '../services/bffApi';
import { TrafficLineChart } from './TrafficLineChart';

interface NodeDetailPanelProps {
  intersectionId: string;
  onClose: () => void;
  /** Incremented by the dashboard on each processed batch so the panel refreshes instantly */
  refreshTrigger?: number;
}

const STATUS_LABEL = {
  congestionado: 'Crítico',
  moderado: 'Moderado',
  fluido: 'Fluido',
} as const;

export const NodeDetailPanel: React.FC<NodeDetailPanelProps> = ({
  intersectionId,
  onClose,
  refreshTrigger = 0,
}) => {
  const [detail, setDetail] = useState<IntersectionAnalyticsDetail | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [patternOverride, setPatternOverride] = useState<TrafficPatternType | null>(null);

  useEffect(() => {
    let isMounted = true;
    const isSameIntersectionRefresh = Boolean(detail && detail.intersection.id === intersectionId);
    if (!isSameIntersectionRefresh) {
      setIsLoading(true);
      setPatternOverride(null);
    }

    fetchIntersectionAnalyticsFromBff(intersectionId, {
      fastRefresh: refreshTrigger > 0 && isSameIntersectionRefresh,
    }).then((res) => {
      if (isMounted) {
        setDetail(res);
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intersectionId, refreshTrigger]);

  const closeButton = (
    <button
      type="button"
      id="btn-back-dashboard"
      className="icon-btn"
      onClick={onClose}
      aria-label="Cerrar inspector"
      title="Cerrar vista dividida"
    >
      <X size={15} strokeWidth={1.75} />
    </button>
  );

  if (isLoading || !detail) {
    return (
      <aside className="inspector">
        <div className="inspector-bar">
          <div className="inspector-crumbs">
            NODOS <ChevronRight size={12} strokeWidth={1.75} /> <span className="current">{intersectionId}</span>
          </div>
          {closeButton}
        </div>
        <div className="inspector-loading">
          <span className="spinner" />
          GET /api/intersections/{intersectionId}/history
        </div>
      </aside>
    );
  }

  const { intersection, timeSeries, metrics } = detail;
  const activePattern = patternOverride || metrics.patternType;
  const isAnomalous = activePattern === 'anomalo';
  const statusClass =
    intersection.status === 'congestionado'
      ? 'c-critical'
      : intersection.status === 'moderado'
      ? 'c-moderate'
      : 'c-fluid';
  const durationClass =
    metrics.congestionDurationMinutes > 15
      ? 'c-critical'
      : metrics.congestionDurationMinutes > 0
      ? 'c-moderate'
      : 'c-fluid';

  return (
    <aside className="inspector" aria-label="Inspector de telemetría del nodo">
      <div className="inspector-bar">
        <div className="inspector-crumbs">
          NODOS <ChevronRight size={12} strokeWidth={1.75} />
          <span className="current">{intersection.cameraCode}</span>
        </div>
        <div className="inspector-bar-right">
          <span className="bff-chip" title="Transparencia de acceso: el BFF unifica la telemetría de todos los workers">
            BFF · <strong>{intersection.workerNodeId}</strong>
          </span>
          {closeButton}
        </div>
      </div>

      {/* Node header */}
      <section className="inspector-section">
        <div className="node-head">
          <div>
            <div className="node-meta">
              <span className="code">{intersection.cameraCode}</span>
              <span className="dot-sep">·</span>
              <span>{intersection.zone.toUpperCase()}</span>
              <span className="dot-sep">·</span>
              <span>
                {intersection.coordinates[0].toFixed(4)}, {intersection.coordinates[1].toFixed(4)}
              </span>
            </div>
            <h1 className="node-title">{intersection.name}</h1>
            <div className="node-updated">
              ACTUALIZADO <span>{intersection.lastUpdated}</span>
            </div>
          </div>

          <div className="node-kpis">
            <div className="kpi-row">
              <div className="kpi">
                <span className={`kpi-value ${statusClass}`}>{intersection.vehicleCount}</span>
                <span className="kpi-unit">VEH</span>
              </div>
              <div className="kpi secondary">
                <span className="kpi-value">{intersection.averageSpeedKmh}</span>
                <span className="kpi-unit">KM/H</span>
              </div>
            </div>
            <span className="status-badge">
              <span className={`status-dot ${intersection.status}`} />
              {STATUS_LABEL[intersection.status]}
            </span>
          </div>
        </div>
      </section>

      {/* Time series */}
      <section className="inspector-section" aria-label="Evolución histórica vehicular">
        <div className="section-head">
          <div>
            <div className="section-title">Evolución de volumen</div>
            <div className="section-sub">
              {timeSeries[0]?.hour} — {timeSeries[timeSeries.length - 1]?.hour} · RESULTS_DB
            </div>
          </div>
          <div className="section-stats">
            <div className="section-stat">
              <span className="label-caps">Pico</span>
              <strong>
                {metrics.peakVehicles} <span className="c-tertiary">@ {metrics.peakHour}</span>
              </strong>
            </div>
            <div className="section-stat">
              <span className="label-caps">Media 6h</span>
              <strong>{metrics.avgVehiclesLast6h}</strong>
            </div>
            <div className="section-stat">
              <span className="label-caps">Capacidad</span>
              <strong>{intersection.maxCapacity}</strong>
            </div>
          </div>
        </div>

        <TrafficLineChart data={timeSeries} maxCapacity={intersection.maxCapacity} />
      </section>

      {/* Computed metrics */}
      <section className="metrics-grid" aria-label="Métricas calculadas">
        <article className="metric-col" data-testid="metric-duration-card">
          <div className="metric-col-head">
            <span className="label-caps">Duración de saturación</span>
          </div>
          <div className="metric-hero">
            <span className={`metric-hero-value ${durationClass}`}>{metrics.congestionDurationMinutes}</span>
            <span className="metric-hero-unit">MIN</span>
          </div>
          <span className="metric-caption">UMBRAL · {intersection.maxCapacity} VEH</span>
        </article>

        <article className="metric-col" data-testid="metric-pattern-card">
          <div className="metric-col-head">
            <span className="label-caps">Patrón</span>
            <div className="segmented small" role="tablist" aria-label="Clasificación del patrón">
              <button
                type="button"
                className={`segmented-item ${!isAnomalous ? 'active' : ''}`}
                onClick={() => setPatternOverride('habitual')}
              >
                Habitual
              </button>
              <button
                type="button"
                className={`segmented-item ${isAnomalous ? 'active' : ''}`}
                onClick={() => setPatternOverride('anomalo')}
              >
                Anómalo
              </button>
            </div>
          </div>
          <div
            className={`pattern-value ${isAnomalous ? 'anomalo' : 'habitual'}`}
            data-testid="categorical-pattern-badge"
          >
            <span className="marker" />
            {isAnomalous ? 'PATRÓN ANÓMALO · DESVÍO ATÍPICO' : 'PATRÓN HABITUAL · HORA PICO'}
          </div>
          <span className="metric-caption">
            {isAnomalous ? '+34% SOBRE MEDIA SEMANAL' : 'COINCIDE CON PERFIL ESTACIONAL'}
          </span>
        </article>
      </section>

      <div className="inspector-foot">
        <span>QUEUE · camera_processing_queue</span>
        <span>{metrics.queueStatus === 'activo' ? 'ACTIVA' : 'RETENIENDO'}</span>
      </div>
    </aside>
  );
};
