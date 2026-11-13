import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/traffic';
import { API_REST_URL, AUTH_SERVICE_URL } from '../config';

interface LoginViewProps {
  onLoginSuccess: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const { login, isLoading, error, clearError } = useAuth();
  const [username, setUsername] = useState<string>('operador.montevideo');
  const [password, setPassword] = useState<string>('urbano2026');
  const [selectedRole, setSelectedRole] = useState<UserRole>('Operador');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await login({
      username,
      password,
      role: selectedRole,
    });
    if (success) {
      onLoginSuccess();
    }
  };

  const applyQuickRole = (role: UserRole, user: string, pass: string) => {
    clearError();
    setSelectedRole(role);
    setUsername(user);
    setPassword(pass);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo-badge">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="6" y="2" width="12" height="20" rx="3" />
              <circle cx="12" cy="7" r="1.6" fill="#ef4444" stroke="none" />
              <circle cx="12" cy="12" r="1.6" fill="#f59e0b" stroke="none" />
              <circle cx="12" cy="17" r="1.6" fill="#10b981" stroke="none" />
            </svg>
          </div>
          <span className="system-pill">SISTEMA DISTRIBUIDO DE SUPERVISIÓN VIAL</span>
          <h1 className="login-title">Control de Tránsito Urbano</h1>
          <p className="login-subtitle">
            Autenticación centralizada mediante tokens JWT en Backend for Frontend (FastAPI)
          </p>
        </div>

        <div className="role-selector-tabs" role="group" aria-label="Rol de acceso">
          <button
            type="button"
            className={`role-tab ${selectedRole === 'Operador' ? 'active' : ''}`}
            onClick={() => applyQuickRole('Operador', 'operador.montevideo', 'urbano2026')}
          >
            Rol: Operador Vial
          </button>
          <button
            type="button"
            className={`role-tab ${selectedRole === 'Administrador' ? 'active' : ''}`}
            onClick={() => applyQuickRole('Administrador', 'admin.central', 'admin2026')}
          >
            Rol: Administrador
          </button>
        </div>

        {error && (
          <div className="login-alert-error" role="alert" data-testid="login-error-alert">
            <div className="alert-title">Error de Autenticación (HTTP 401)</div>
            <div className="alert-body">{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username-input">Usuario Institucional</label>
            <input
              id="username-input"
              type="text"
              value={username}
              onChange={(e) => {
                if (error) clearError();
                setUsername(e.target.value);
              }}
              placeholder="Ej. operador.montevideo o admin.central"
              required
              disabled={isLoading}
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password-input">Contraseña de Acceso</label>
            <input
              id="password-input"
              type="password"
              value={password}
              onChange={(e) => {
                if (error) clearError();
                setPassword(e.target.value);
              }}
              placeholder="Ingrese su contraseña"
              required
              disabled={isLoading}
              autoComplete="current-password"
            />
          </div>

          <button
            id="login-submit-btn"
            type="submit"
            className="btn-login-submit"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="loading-inline">
                <span className="spinner-sm" /> Validando credenciales con BFF FastAPI...
              </span>
            ) : (
              `Iniciar Sesión como ${selectedRole}`
            )}
          </button>
        </form>

        <div className="login-demo-helpers">
          <span className="helper-label">Pruebas rápidas para evaluación del MVP:</span>
          <div className="helper-buttons">
            <button
              type="button"
              className="btn-helper"
              onClick={() => applyQuickRole('Operador', 'operador.montevideo', 'urbano2026')}
            >
              Cargar Operador Válido
            </button>
            <button
              type="button"
              className="btn-helper"
              onClick={() => applyQuickRole('Administrador', 'admin.central', 'admin2026')}
            >
              Cargar Admin Válido
            </button>
            <button
              type="button"
              className="btn-helper danger"
              onClick={() => {
                clearError();
                setUsername('usuario.no.autorizado');
                setPassword('invalid');
              }}
            >
              Simular Credenciales Inválidas
            </button>
          </div>
        </div>

        <footer className="login-footer-meta">
          <div>BFF Gateway: <code>{API_REST_URL}</code></div>
          <div>Auth Service: <code>{AUTH_SERVICE_URL}</code></div>
        </footer>
      </div>
    </div>
  );
};
