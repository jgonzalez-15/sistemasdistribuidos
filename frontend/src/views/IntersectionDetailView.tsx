import React, { useEffect, useState } from 'react';
import { IntersectionAnalyticsDetail } from '../types/traffic';
import { fetchIntersectionAnalyticsFromBff } from '../services/bffApi';
import { TrafficLineChart } from '../components/TrafficLineChart';

interface IntersectionDetailViewProps {
  intersectionId: string;
  onBackToDashboard: () => void;
  /** Signals when the parent dashboard triggers a new batch so the side panel refreshes immediately */
  refreshTrigger?: number;
}

export const IntersectionDetailView: React.FC<IntersectionDetailViewProps> = ({
  intersectionId,
  onBackToDashboard,
  refreshTrigger = 0,
}) => {
  const [detail, setDetail] = useState<IntersectionAnalyticsDetail | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [customPatternOverride, setCustomPatternOverride] = useState<'habitual' | 'anomalo' | null>(
    null
  );

  useEffect(() => {
    let isMounted = true;
    const isSameIntersectionRefresh = Boolean(detail && detail.intersection.id === intersectionId);
    // Show full spinner only when switching intersections, keep smooth transition on batch refresh
    if (!isSameIntersectionRefresh) {
      setIsLoading(true);
      setCustomPatternOverride(null);
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
  }, [intersectionId, refreshTrigger]);

  if (isLoading || !detail) {
    return (
      <aside className="side-detail-panel">
        <div className="detail-top-actions">
          <button type="button" className="btn-back" onClick={onBackToDashboard}>
            ✕ Cerrar Panel y Volver al Mapa Completo
          </button>
        </div>
        <div className="loading-state-box">
          <div className="spinner-lg" />
          <p>
            Recuperando serie temporal histórica desde BFF FastAPI (
            <code>GET /api/intersections/{intersectionId}/history</code>)...
          </p>
        </div>
      </aside>
    );
  }

  const { intersection, timeSeries, metrics } = detail;
  const activePatternType = customPatternOverride || metrics.patternType;
  const isAnomalous = activePatternType === 'anomalo';

  const statusColorClass =
    intersection.status === 'congestionado'
      ? 'status-badge-red'
      : intersection.status === 'moderado'
      ? 'status-badge-yellow'
      : 'status-badge-green';

  return (
    <aside className="side-detail-panel" aria-label="Detalle analítico de intersección">
      {/* Top Return Navigation */}
      <div className="detail-top-actions">
        <div className="transparency-pill">
          <span className="shield-dot" />
          Transparencia de Acceso BFF · Nodo: <code>{intersection.workerNodeId}</code>
        </div>

        <button
          type="button"
          id="btn-back-dashboard"
          className="btn-close-split"
          onClick={onBackToDashboard}
          title="Cerrar vista dividida y expandir mapa"
        >
          ✕ Cerrar Detalle
        </button>
      </div>

      {/* Intersection Header */}
      <section className="detail-header-card">
        <div className="detail-header-left">
          <div className="detail-meta-row">
            <span className="camera-code-badge">{intersection.cameraCode}</span>
            <span className="zone-pill">{intersection.zone}</span>
            <span className="id-pill">
              Coords: {intersection.coordinates[0].toFixed(4)}, {intersection.coordinates[1].toFixed(4)}
            </span>
          </div>
          <h1 className="detail-title">{intersection.name}</h1>
          <p className="detail-subtitle">
            Serie histórica consolidada en PostgreSQL (<code>results_db</code>) · Última
            actualización: <strong>{intersection.lastUpdated}</strong>
          </p>
        </div>

        <div className="detail-header-right">
          <span className={`status-badge-lg ${statusColorClass}`}>
            {intersection.status === 'congestionado'
              ? 'Estado Crítico: Congestionado'
              : intersection.status === 'moderado'
              ? 'Estado Preventivo: Moderado'
              : 'Estado Óptimo: Tránsito Fluido'}
          </span>
          <div className="current-count-box">
            <span className="count-num">{intersection.vehicleCount}</span>
            <span className="count-lbl">
              vehículos actuales · {intersection.averageSpeedKmh} km/h
            </span>
          </div>
        </div>
      </section>

      {/* 2D Line Chart Panel */}
      <section className="chart-panel-card" aria-label="Evolución histórica vehicular">
        <div className="panel-card-header">
          <div>
            <h2 className="panel-title">
              Evolución de Volumen Vehicular por Hora (Gráfico 2D)
            </h2>
            <p className="panel-subtitle">
              Conteos agregados de frames procesados en paralelo por el clúster de Visión Artificial
              ({timeSeries[0]?.hour} hs – {timeSeries[timeSeries.length - 1]?.hour} hs)
            </p>
          </div>
          <div className="chart-kpi-mini">
            <div>
              <span>Hora Pico:</span>{' '}
              <strong>
                {metrics.peakHour} hs ({metrics.peakVehicles} veh.)
              </strong>
            </div>
            <div>
              <span>Media 6h:</span>{' '}
              <strong>{metrics.avgVehiclesLast6h} veh./h</strong>
            </div>
          </div>
        </div>

        <TrafficLineChart data={timeSeries} maxCapacity={intersection.maxCapacity} />
      </section>

      {/* Textual Analytical Metrics Below Chart */}
      <section
        className="analytical-metrics-grid"
        aria-label="Métricas calculadas de congestión y patrón de tráfico"
      >
        {/* Metric 1: Congestion Duration in Minutes */}
        <article className="metric-detail-card duration-card" data-testid="metric-duration-card">
          <div className="metric-card-eyebrow">MÉTRICA CALCULADA EN TIEMPO REAL #1</div>
          <h3 className="metric-card-heading">Duración del Congestionamiento Actual</h3>

          <div className="duration-highlight-row">
            <span
              className={`duration-big-value ${
                metrics.congestionDurationMinutes > 15
                  ? 'text-red'
                  : metrics.congestionDurationMinutes > 0
                  ? 'text-yellow'
                  : 'text-green'
              }`}
            >
              {metrics.congestionDurationMinutes}
            </span>
            <div className="duration-unit-block">
              <span className="duration-unit">minutos continuos</span>
              <span className="duration-threshold-note">
                {metrics.congestionDurationMinutes > 0
                  ? 'Por encima del umbral de saturación de calzada'
                  : 'Sin retención vehicular activa en este momento'}
              </span>
            </div>
          </div>

          <p className="metric-card-explanation">
            Calculado por el BFF a partir de los intervalos consecutivos donde el conteo vehicular
            supera la capacidad operativa de diseño ({intersection.maxCapacity} vehículos máx.).
          </p>
        </article>

        {/* Metric 2: Categorical Traffic Pattern Evaluation (Habitual vs Anómalo) */}
        <article className="metric-detail-card pattern-card" data-testid="metric-pattern-card">
          <div className="metric-card-header-flex">
            <div>
              <div className="metric-card-eyebrow">MÉTRICA CALCULADA EN TIEMPO REAL #2</div>
              <h3 className="metric-card-heading">
                Evaluación Categórica del Comportamiento Vial
              </h3>
            </div>

            <div className="pattern-demo-switch">
              <button
                type="button"
                className={`btn-mini-toggle ${!isAnomalous ? 'active' : ''}`}
                onClick={() => setCustomPatternOverride('habitual')}
              >
                Habitual
              </button>
              <button
                type="button"
                className={`btn-mini-toggle ${isAnomalous ? 'active-anomaly' : ''}`}
                onClick={() => setCustomPatternOverride('anomalo')}
              >
                Anómalo
              </button>
            </div>
          </div>

          <div className="categorical-badge-row">
            <span
              className={`categorical-tag ${
                isAnomalous ? 'tag-pattern-anomalous' : 'tag-pattern-habitual'
              }`}
              data-testid="categorical-pattern-badge"
            >
              {isAnomalous
                ? 'PATRÓN ANÓMALO · Desviación Atípica Detectada'
                : 'PATRÓN HABITUAL · Comportamiento Hora Pico'}
            </span>
          </div>

          <p className="metric-card-explanation">
            {isAnomalous
              ? 'El flujo observado excede significativamente la banda histórica esperada para esta franja horaria (+34% sobre la media semanal). Se recomienda verificación de incidente o sincronización semafórica.'
              : 'La curva de acumulación vehicular coincide con el perfil histórico estacional (Hora Pico) almacenado en PostgreSQL para días hábiles.'}
          </p>
        </article>
      </section>
    </aside>
  );
};
