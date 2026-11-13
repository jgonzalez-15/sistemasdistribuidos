import React from 'react';
import { useAuth } from '../context/AuthContext';
import { API_REST_URL } from '../config';

interface TopNavbarProps {
  onNavigateDashboard: () => void;
  currentView: 'dashboard' | 'detail';
  isFaultTolerantDemoMode?: boolean;
  onToggleFaultTolerance?: () => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  onNavigateDashboard,
  currentView,
  isFaultTolerantDemoMode = false,
  onToggleFaultTolerance,
}) => {
  const { session, logout } = useAuth();

  return (
    <header className="top-navbar">
      <div className="navbar-brand" onClick={onNavigateDashboard} role="button" tabIndex={0}>
        <div className="brand-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <rect x="6" y="2" width="12" height="20" rx="3" />
            <circle cx="12" cy="7" r="1.5" fill="#ef4444" stroke="none" />
            <circle cx="12" cy="12" r="1.5" fill="#f59e0b" stroke="none" />
            <circle cx="12" cy="17" r="1.5" fill="#10b981" stroke="none" />
          </svg>
        </div>
        <div>
          <span className="brand-title">SGTU Montevideo — Panel de Supervisión Urbana</span>
          <span className="brand-subtitle">
            Arquitectura Distribuida · BFF FastAPI ({API_REST_URL})
          </span>
        </div>
      </div>

      <div className="navbar-actions">
        {onToggleFaultTolerance && (
          <button
            type="button"
            onClick={onToggleFaultTolerance}
            className={`status-pill-btn ${isFaultTolerantDemoMode ? 'degraded' : 'healthy'}`}
            title="Alternar simulación de caída de workers CV para demostrar Tolerancia a Fallos (Twelve-Factor Stateless)"
          >
            <span className="pulse-dot" />
            {isFaultTolerantDemoMode
              ? 'Workers CV Pausados · RabbitMQ Reteniendo'
              : 'Cluster CV & RabbitMQ Activos'}
          </button>
        )}

        {currentView === 'detail' && (
          <button type="button" className="btn-secondary-nav" onClick={onNavigateDashboard}>
            Panel Principal
          </button>
        )}

        {session && (
          <div className="user-badge" title={`Token JWT emitido a las ${session.issuedAt}`}>
            <div className="user-info">
              <span className="user-name">{session.username}</span>
              <span className={`role-tag ${session.role === 'Administrador' ? 'admin' : 'operator'}`}>
                {session.role} · JWT Activo
              </span>
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn-logout"
          onClick={logout}
          id="logout-button"
        >
          Cerrar Sesión
        </button>
      </div>
    </header>
  );
};
