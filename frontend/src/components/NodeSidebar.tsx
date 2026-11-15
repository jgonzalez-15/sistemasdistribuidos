import React from 'react';
import { Waypoints } from 'lucide-react';
import { CongestionLevel, IntersectionSummary } from '../types/traffic';

export type StatusFilter = CongestionLevel | 'todos';

interface NodeSidebarProps {
  intersections: IntersectionSummary[];
  filterStatus: StatusFilter;
  onChangeFilter: (filter: StatusFilter) => void;
  selectedIntersectionId: string | null;
  onSelectIntersection: (id: string) => void;
  onCloseDetail: () => void;
  lastSyncTime: string;
}

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'congestionado', label: 'Crítico' },
  { key: 'moderado', label: 'Mod' },
  { key: 'fluido', label: 'Fluido' },
  { key: 'sin_datos', label: 'Sin datos' },
];

export const NodeSidebar: React.FC<NodeSidebarProps> = ({
  intersections,
  filterStatus,
  onChangeFilter,
  selectedIntersectionId,
  onSelectIntersection,
  onCloseDetail,
  lastSyncTime,
}) => {
  const critical = intersections.filter((i) => i.status === 'congestionado').length;
  const moderate = intersections.filter((i) => i.status === 'moderado').length;
  const fluid = intersections.filter((i) => i.status === 'fluido').length;
  const totalVehicles = intersections
    .filter((i) => i.status !== 'sin_datos')
    .reduce((acc, i) => acc + i.vehicleCount, 0);

  const visible =
    filterStatus === 'todos'
      ? intersections
      : intersections.filter((i) => i.status === filterStatus);

  return (
    <aside className="node-sidebar glass" aria-label="Red vial monitoreada">
      <div className="sidebar-head">
        <div className="sidebar-title">
          <Waypoints size={15} strokeWidth={1.75} />
          Red Vial
        </div>
        <span className="sidebar-sync">
          <span className="live" />
          SYNC {lastSyncTime || '--:--:--'}
        </span>
      </div>

      <div className="metric-strip">
        <div className="metric-cell">
          <span className="metric-value">{intersections.length}</span>
          <span className="metric-label">Nodos</span>
        </div>
        <div className="metric-cell">
          <span className="metric-value c-critical">{critical}</span>
          <span className="metric-label">Críticos</span>
        </div>
        <div className="metric-cell">
          <span className="metric-value c-moderate">{moderate}</span>
          <span className="metric-label">Mod</span>
        </div>
        <div className="metric-cell">
          <span className="metric-value c-fluid">{fluid}</span>
          <span className="metric-label">Fluidos</span>
        </div>
      </div>

      <div className="sidebar-filters">
        <div className="segmented stretch" role="tablist" aria-label="Filtrar por estado">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filterStatus === f.key}
              className={`segmented-item ${filterStatus === f.key ? 'active' : ''}`}
              onClick={() => onChangeFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="node-list-head">
        <span className="label-caps">Intersección</span>
        <span className="label-caps" title="Vehículos visibles en el clip (mediana por frame)">
          Veh visibles
        </span>
      </div>

      <ul className="node-list">
        {visible.length === 0 && <li className="node-list-empty">SIN NODOS EN ESTE ESTADO</li>}
        {visible.map((item) => {
          const isSelected = item.id === selectedIntersectionId;
          const isNoData = item.status === 'sin_datos';
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`node-row ${isSelected ? 'selected' : ''}`}
                onClick={() => (isSelected ? onCloseDetail() : onSelectIntersection(item.id))}
                data-testid={`intersection-card-${item.id}`}
                title={`${item.name} · ${item.lastUpdated}`}
              >
                <span className={`status-dot ${item.status}`} />
                <span className="node-row-name">{item.name}</span>
                <span className={`node-row-count ${isNoData ? 'c-tertiary' : ''}`}>
                  {isNoData ? 'SIN DATOS' : item.vehicleCount}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="sidebar-foot">
        <span>VEH VISIBLES (RED)</span>
        <span>
          <strong>{totalVehicles}</strong> VEH
        </span>
      </div>
    </aside>
  );
};
