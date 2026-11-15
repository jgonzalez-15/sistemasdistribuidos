import React from 'react';
import { LogOut, Moon, Server, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { API_REST_URL } from '../config';

export type ViewMode = 'map' | 'split' | 'system';
export type ThemeMode = 'dark' | 'light';

interface HeaderProps {
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  onNavigateHome: () => void;
  isFaultTolerantDemoMode: boolean;
  onToggleFaultTolerance: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
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
  theme,
  onToggleTheme,
}) => {
  const { session, logout } = useAuth();
  const initials = session?.username.slice(0, 2).toUpperCase() ?? '··';
  const isAdmin = session?.role === 'Administrador';

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
          {isAdmin && (
            <button
              type="button"
              role="tab"
              id="tab-system-backend"
              aria-selected={viewMode === 'system'}
              className={`segmented-item sys-tab ${viewMode === 'system' ? 'active' : ''}`}
              onClick={() => onChangeViewMode('system')}
              title="Vista exclusiva de Administrador: Topología, Colas RabbitMQ, Bases de Datos y Logs del Sistema"
            >
              <Server size={13} strokeWidth={1.75} />
              <span>Sistema</span>
            </button>
          )}
        </div>

        <span className="cmd-divider" />

        {session && (
          <div className="user-pill" title={`JWT emitido a las ${session.issuedAt}`}>
            <span className="user-avatar">{initials}</span>
            <span className="user-name">{session.username}</span>
            <span className={`user-role ${isAdmin ? 'is-admin' : ''}`}>{session.role}</span>
          </div>
        )}

        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          id="theme-toggle-button"
          aria-label={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
          data-tooltip={theme === 'light' ? 'Modo oscuro' : 'Modo claro'}
        >
          {theme === 'light' ? <Moon size={15} strokeWidth={1.75} /> : <Sun size={15} strokeWidth={1.75} />}
        </button>

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
