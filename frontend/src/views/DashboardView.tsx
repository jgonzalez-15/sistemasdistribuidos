import React, { useCallback, useEffect, useState } from 'react';
import { IntersectionSummary } from '../types/traffic';
import {
  fetchIntersectionsFromBff,
  resetNormalTrafficSimulation,
  simulateNextWorkerBatchUpdate,
  triggerConcurrentCongestionSimulation,
} from '../services/bffApi';
import { NodeSidebar, StatusFilter } from '../components/NodeSidebar';
import { SimulationToolbar } from '../components/SimulationToolbar';
import { TrafficMap } from '../components/TrafficMap';
import { NodeDetailPanel } from '../components/NodeDetailPanel';

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
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('todos');
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

  const visibleIntersections =
    filterStatus === 'todos'
      ? intersections
      : intersections.filter((i) => i.status === filterStatus);

  const isSplitOpen = Boolean(selectedIntersectionId);

  return (
    <main className="workspace">
      {isFaultTolerantDemoMode && (
        <div className="fault-banner" role="status">
          <strong>TOLERANCIA A FALLOS ACTIVA:</strong> Workers <code>cv-module</code> en pausa ·{' '}
          <strong>RabbitMQ</strong> reteniendo <code>camera_processing_queue</code> ·{' '}
          <strong>BFF FastAPI</strong> sirviendo último estado consolidado en PostgreSQL.
        </div>
      )}

      <div className={`split-stage ${isSplitOpen ? 'is-split' : ''}`}>
        <section className="map-pane" aria-label="Mapa en vivo del tránsito en Montevideo">
          <NodeSidebar
            intersections={intersections}
            filterStatus={filterStatus}
            onChangeFilter={setFilterStatus}
            selectedIntersectionId={selectedIntersectionId}
            onSelectIntersection={onSelectIntersection}
            onCloseDetail={onCloseDetail}
            lastSyncTime={lastSyncTime}
          />

          <SimulationToolbar
            simulationMode={simulationMode}
            isAutoBatchActive={isAutoBatchActive}
            isDisabled={isFaultTolerantDemoMode}
            compact={isSplitOpen}
            onTriggerConcurrent={handleTriggerConcurrentCongestion}
            onResetMixed={handleResetNormal}
            onProcessBatch={handleSimulateBatch}
            onToggleAutoBatch={() => setIsAutoBatchActive((prev) => !prev)}
          />

          {isLoading ? (
            <div className="map-loading">
              <span className="spinner" />
              CARGANDO TELEMETRÍA BFF · MONTEVIDEO
            </div>
          ) : (
            <TrafficMap
              intersections={visibleIntersections}
              selectedIntersectionId={selectedIntersectionId}
              onSelectIntersection={onSelectIntersection}
              isSplitView={isSplitOpen}
            />
          )}
        </section>

        <section
          className={`inspector-pane ${isSplitOpen ? 'open' : ''}`}
          aria-hidden={!isSplitOpen}
        >
          {selectedIntersectionId && (
            <NodeDetailPanel
              intersectionId={selectedIntersectionId}
              onClose={onCloseDetail}
              refreshTrigger={refreshCounter}
            />
          )}
        </section>
      </div>
    </main>
  );
};
