import React, { useCallback, useEffect, useState } from 'react';
import { CongestionLevel, IntersectionSummary } from '../types/traffic';
import {
  fetchIntersectionsFromBff,
  resetNormalTrafficSimulation,
  simulateNextWorkerBatchUpdate,
  triggerConcurrentCongestionSimulation,
} from '../services/bffApi';
import { MontevideoTrafficMap } from '../components/MontevideoTrafficMap';
import { IntersectionDetailView } from './IntersectionDetailView';

interface DashboardViewProps {
  selectedIntersectionId: string | null;
  onSelectIntersection: (id: string) => void;
  onCloseDetail: () => void;
  isFaultTolerantDemoMode: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  selectedIntersectionId,
  onSelectIntersection,
  onCloseDetail,
  isFaultTolerantDemoMode,
}) => {
  const [intersections, setIntersections] = useState<IntersectionSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filterStatus, setFilterStatus] = useState<CongestionLevel | 'todos'>('todos');
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  const [simulationMode, setSimulationMode] = useState<'normal' | 'concurrent_congestion'>('normal');
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  const [isAutoBatchActive, setIsAutoBatchActive] = useState<boolean>(false);

  const loadDashboardData = async () => {
    setIsLoading(true);
    const response = await fetchIntersectionsFromBff();
    setIntersections(response.data);
    setLastSyncTime(new Date().toLocaleTimeString());
    setIsLoading(false);
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  const handleTriggerConcurrentCongestion = () => {
    const updated = triggerConcurrentCongestionSimulation();
    setIntersections(updated);
    setSimulationMode('concurrent_congestion');
    setLastSyncTime(new Date().toLocaleTimeString());
    setRefreshCounter((c) => c + 1);
  };

  const handleResetNormal = () => {
    const updated = resetNormalTrafficSimulation();
    setIntersections(updated);
    setSimulationMode('normal');
    setLastSyncTime(new Date().toLocaleTimeString());
    setRefreshCounter((c) => c + 1);
  };

  const handleSimulateBatch = useCallback(() => {
    if (isFaultTolerantDemoMode) return;
    const updated = simulateNextWorkerBatchUpdate();
    setIntersections(updated);
    setLastSyncTime(new Date().toLocaleTimeString());
    setRefreshCounter((c) => c + 1);
  }, [isFaultTolerantDemoMode]);

  useEffect(() => {
    if (isFaultTolerantDemoMode && isAutoBatchActive) {
      setIsAutoBatchActive(false);
      return;
    }
    if (!isAutoBatchActive) return;

    const timerId = window.setInterval(() => {
      handleSimulateBatch();
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [isAutoBatchActive, isFaultTolerantDemoMode, handleSimulateBatch]);

  const countFluid = intersections.filter((i) => i.status === 'fluido').length;
  const countModerate = intersections.filter((i) => i.status === 'moderado').length;
  const countCongested = intersections.filter((i) => i.status === 'congestionado').length;
  const totalVehicles = intersections.reduce((acc, i) => acc + i.vehicleCount, 0);

  const visibleIntersections =
    filterStatus === 'todos'
      ? intersections
      : intersections.filter((i) => i.status === filterStatus);

  const isSplitOpen = Boolean(selectedIntersectionId);

  return (
    <main className="waze-workspace-container">
      {isFaultTolerantDemoMode && (
        <div className="fault-tolerance-floating-banner" role="status">
          <strong>Tolerancia a Fallos Activa (Stateless Twelve-Factor):</strong> Workers{' '}
          <code>cv-module</code> en pausa · <strong>RabbitMQ</strong> reteniendo cola{' '}
          <code>camera_processing_queue</code> · <strong>BFF FastAPI</strong> sirviendo último
          estado consolidado en PostgreSQL.
        </div>
      )}

      {/* Split Workspace: Map on Left (100% -> 50%) + Apple Spring Side Panel on Right (0% -> 50%) */}
      <div className={`apple-split-stage ${isSplitOpen ? 'is-split-open' : ''}`}>
        {/* LEFT PANE: Interactive Montevideo Map + Floating Waze HUD */}
        <section className="map-pane-left" aria-label="Mapa en vivo del tránsito en Montevideo">
          {/* Top-Left Floating Waze Summary Card (like reference image 1) */}
          <div className="waze-floating-hud-left">
            <div className="waze-hud-header">
              <div className={`waze-live-badge ${countCongested >= 4 ? 'critical' : ''}`}>
                <span className="waze-pulse-dot" />
                <span>LIVE TRAFFIC · MONTEVIDEO</span>
              </div>
              <span className="waze-sync-clock">Sync: {lastSyncTime || '...'}</span>
            </div>

            <h2 className="waze-hud-city-title">Montevideo — Red Vial</h2>
            <p className="waze-hud-status-line">
              <strong className="text-red">{countCongested} congestionadas</strong> ·{' '}
              <span className="text-yellow">{countModerate} moderadas</span> ·{' '}
              <span className="text-green">{countFluid} fluidas</span> ({totalVehicles} veh.)
            </p>

            {/* Filter Chips inside HUD */}
            <div className="waze-hud-filters">
              <button
                type="button"
                className={`hud-chip ${filterStatus === 'todos' ? 'active' : ''}`}
                onClick={() => setFilterStatus('todos')}
              >
                Todas ({intersections.length})
              </button>
              <button
                type="button"
                className={`hud-chip chip-red ${filterStatus === 'congestionado' ? 'active' : ''}`}
                onClick={() => setFilterStatus('congestionado')}
              >
                Rojo ({countCongested})
              </button>
              <button
                type="button"
                className={`hud-chip chip-yellow ${filterStatus === 'moderado' ? 'active' : ''}`}
                onClick={() => setFilterStatus('moderado')}
              >
                Amarillo ({countModerate})
              </button>
              <button
                type="button"
                className={`hud-chip chip-green ${filterStatus === 'fluido' ? 'active' : ''}`}
                onClick={() => setFilterStatus('fluido')}
              >
                Verde ({countFluid})
              </button>
            </div>

            <div className="waze-hud-hint">
              Pasa el cursor sobre un nodo para ver su tarjeta · Haz clic para abrir el panel dividido
            </div>
          </div>

          {/* Top-Right Floating Simulation Controls Pill */}
          <div className="waze-floating-hud-right">
            <button
              type="button"
              id="btn-concurrent-congestion"
              className={`btn-hud-sim ${
                simulationMode === 'concurrent_congestion' ? 'active-danger' : ''
              }`}
              onClick={handleTriggerConcurrentCongestion}
              title="Simular congestión simultánea en múltiples arterias (escalabilidad horizontal RabbitMQ)"
            >
              ⚡ Congestión Concurrente
            </button>
            <button
              type="button"
              id="btn-normal-traffic"
              className={`btn-hud-sim ${simulationMode === 'normal' ? 'active-neutral' : ''}`}
              onClick={handleResetNormal}
            >
              Estado Mixto
            </button>
            <div className="hud-batch-column">
              <button
                type="button"
                id="btn-next-batch"
                className="btn-hud-sim batch-btn"
                onClick={handleSimulateBatch}
                disabled={isFaultTolerantDemoMode}
              >
                ↻ Procesar Nuevo Frame Batch
              </button>
              <button
                type="button"
                id="btn-auto-batch"
                className={`btn-hud-sim auto-batch-btn ${isAutoBatchActive ? 'is-running' : ''}`}
                onClick={() => setIsAutoBatchActive((prev) => !prev)}
                disabled={isFaultTolerantDemoMode}
                title="Procesar automáticamente un nuevo frame batch cada 1 segundo"
              >
                {isAutoBatchActive ? (
                  <>
                    <span className="auto-live-dot" /> ⏸ Detener Auto (1s)
                  </>
                ) : (
                  '⏱ Auto: Procesar cada 1s'
                )}
              </button>
            </div>
          </div>

          {/* Bottom Floating Quick Selector Strip */}
          <div className="waze-bottom-camera-strip">
            {visibleIntersections.map((item) => {
              const isSelected = item.id === selectedIntersectionId;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`camera-mini-pill status-${item.status} ${
                    isSelected ? 'selected' : ''
                  }`}
                  onClick={() =>
                    isSelected ? onCloseDetail() : onSelectIntersection(item.id)
                  }
                  data-testid={`intersection-card-${item.id}`}
                >
                  <span className="mini-pill-dot" />
                  <span className="mini-pill-name">{item.name}</span>
                  <strong className="mini-pill-count">{item.vehicleCount}</strong>
                </button>
              );
            })}
          </div>

          {isLoading ? (
            <div className="map-loading-overlay">
              <div className="spinner-lg" />
              <p>Cargando cartografía de Montevideo y telemetría BFF FastAPI...</p>
            </div>
          ) : (
            <MontevideoTrafficMap
              intersections={visibleIntersections}
              selectedIntersectionId={selectedIntersectionId}
              onSelectIntersection={onSelectIntersection}
              isSplitView={isSplitOpen}
            />
          )}
        </section>

        {/* RIGHT PANE: Sliding Apple-style Split-Screen Analytical Detail */}
        <section
          className={`detail-pane-right ${isSplitOpen ? 'open' : 'closed'}`}
          aria-hidden={!isSplitOpen}
        >
          {selectedIntersectionId && (
            <IntersectionDetailView
              intersectionId={selectedIntersectionId}
              onBackToDashboard={onCloseDetail}
              refreshTrigger={refreshCounter}
            />
          )}
        </section>
      </div>
    </main>
  );
};
