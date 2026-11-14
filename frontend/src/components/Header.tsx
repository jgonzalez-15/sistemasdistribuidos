import React from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { API_REST_URL } from '../config';

export type ViewMode = 'map' | 'split';

interface HeaderProps {
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  onNavigateHome: () => void;
  isFaultTolerantDemoMode: boolean;
  onToggleFaultTolerance: () => void;
}

export const BrandMark: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="4" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2.75 12h18.5M12 2.75v18.5" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.25" />
    <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    <circle cx="17.25" cy="6.75" r="1.35" fill="#EF4444" />
  </svg>
);

export const Header: React.FC<HeaderProps> = ({
  viewMode,
  onChangeViewMode,
  onNavigateHome,
  isFaultTolerantDemoMode,
  onToggleFaultTolerance,
}) => {
  const { session, logout } = useAuth();
  const initials = session?.username.slice(0, 2).toUpperCase() ?? '··';

  const clusterTooltip = isFaultTolerantDemoMode
    ? `Workers CV en pausa · RabbitMQ reteniendo camera_processing_queue · BFF FastAPI (${API_REST_URL}) sirviendo último estado en PostgreSQL. Clic para restaurar.`
    : `Arquitectura Distribuida · BFF FastAPI (${API_REST_URL}) · Workers CV + RabbitMQ activos. Clic para simular caída de workers.`;

  return (
    <header className="cmd-header">
      <button type="button" className="cmd-brand" onClick={onNavigateHome} aria-label="Ir al mapa general">
        <span className="cmd-brand-mark">
          <BrandMark />
        </span>
        <span className="cmd-brand-text">
          SGTU<span className="sep"> // </span>MONTEVIDEO
        </span>
        <span className="cmd-brand-env">MVP</span>
      </button>

      <div className="cmd-actions">
        <button
          type="button"
          className={`cluster-indicator ${isFaultTolerantDemoMode ? 'degraded' : ''}`}
          onClick={onToggleFaultTolerance}
          data-tooltip={clusterTooltip}
          aria-label="Estado del cluster de visión artificial"
        >
          <span className="cluster-dot" />
          <span className="cluster-label">
            {isFaultTolerantDemoMode ? 'CLUSTER CV · DEGRADADO' : 'CLUSTER CV · ONLINE'}
          </span>
        </button>

        <span className="cmd-divider" />

        <div className="segmented view-switch" role="tablist" aria-label="Modo de vista">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'map'}
            className={`segmented-item ${viewMode === 'map' ? 'active' : ''}`}
            onClick={() => onChangeViewMode('map')}
          >
            Mapa
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'split'}
            className={`segmented-item ${viewMode === 'split' ? 'active' : ''}`}
            onClick={() => onChangeViewMode('split')}
          >
            Vista Dividida
          </button>
        </div>

        <span className="cmd-divider" />

        {session && (
          <div className="user-pill" title={`JWT emitido a las ${session.issuedAt}`}>
            <span className="user-avatar">{initials}</span>
            <span className="user-name">{session.username}</span>
            <span className="user-role">{session.role}</span>
          </div>
        )}

        <button
          type="button"
          className="icon-btn"
          onClick={logout}
          id="logout-button"
          aria-label="Cerrar sesión"
          data-tooltip="Cerrar sesión"
        >
          <LogOut size={15} strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
};
