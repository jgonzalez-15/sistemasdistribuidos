import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Moon, Sun, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/traffic';
import { API_REST_URL, AUTH_SERVICE_URL } from '../config';
import { INITIAL_INTERSECTIONS_MOCK } from '../mocks/trafficMockData';
import { BrandMark, ThemeMode } from './Header';

interface LoginViewProps {
  onLoginSuccess: () => void;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
}

type EndpointState = 'checking' | 'online' | 'offline';

function useEndpointStatus(url: string): EndpointState {
  const [state, setState] = useState<EndpointState>('checking');
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    fetch(`${url}/`, { mode: 'no-cors', signal: controller.signal })
      .then(() => setState('online'))
      .catch(() => setState('offline'))
      .finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [url]);
  return state;
}

function portOf(url: string): string {
  try {
    return new URL(url).port || '80';
  } catch {
    return '—';
  }
}

/* ---------- Unlabeled Charcoal Street Map + Animated Telemetry Overlay ---------- */
const LoginCharcoalMap: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [-34.8995, -56.1645],
      zoom: 13.5,
      zoomSnap: 0.1,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    });

    // Esri World Dark Gray Base: pure charcoal street blocks & coastline with zero street names, zero POI labels, and no API key required
    L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 16,
      }
    ).addTo(map);

    const overlayGroup = L.layerGroup().addTo(map);

    // Subtle real-coordinate street corridors and pulsing camera nodes over the charcoal street grid
    INITIAL_INTERSECTIONS_MOCK.forEach((node, idx) => {
      const color =
        node.status === 'congestionado'
          ? '#EF4444'
          : node.status === 'moderado'
          ? '#F59E0B'
          : '#10B981';

      node.streetCorridors.forEach((corridor) => {
        L.polyline(corridor.coordinates, {
          color,
          weight: 5,
          opacity: 0.14,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(overlayGroup);

        L.polyline(corridor.coordinates, {
          color,
          weight: 1.75,
          opacity: 0.72,
          dashArray: '4, 10',
          className: `login-map-flow ${idx % 2 === 0 ? '' : 'slow'}`,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(overlayGroup);
      });

      const dotHtml = `
        <div class="login-map-node" style="--node-color:${color};animation-delay:${(idx * 0.28).toFixed(2)}s">
          <span class="login-map-node-ring"></span>
          <span class="login-map-node-core"></span>
          <span class="login-map-node-tag">${node.cameraCode}</span>
        </div>
      `;

      L.marker(node.coordinates, {
        interactive: false,
        icon: L.divIcon({
          className: 'login-map-node-icon',
          html: dotHtml,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
      }).addTo(overlayGroup);
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="login-charcoal-map" data-testid="login-charcoal-map" />;
};

export const LoginView: React.FC<LoginViewProps> = ({
  onLoginSuccess,
  theme = 'dark',
  onToggleTheme,
}) => {
  const { login, isLoading, error, clearError } = useAuth();
  const [username, setUsername] = useState<string>('operador.montevideo');
  const [password, setPassword] = useState<string>('urbano2026');
  const [selectedRole, setSelectedRole] = useState<UserRole>('Operador');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const apiState = useEndpointStatus(API_REST_URL);
  const authState = useEndpointStatus(AUTH_SERVICE_URL);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await login({ username, password, role: selectedRole });
    if (success) onLoginSuccess();
  };

  const applyQuickRole = (role: UserRole, user: string, pass: string) => {
    clearError();
    setSelectedRole(role);
    setUsername(user);
    setPassword(pass);
  };

  const endpoints = useMemo(
    () => [
      { name: 'API REST', url: API_REST_URL, state: apiState },
      { name: 'AUTH SERVICE', url: AUTH_SERVICE_URL, state: authState },
    ],
    [apiState, authState]
  );

  return (
    <div className="login-shell">
      {/* Left: form */}
      <section className="login-form-col">
        <div className="login-top-brand">
          <BrandMark size={16} />
          SGTU<span className="sep"> // </span>MONTEVIDEO
        </div>

        {onToggleTheme && (
          <button
            type="button"
            id="login-theme-toggle"
            className="icon-btn login-theme-btn"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro'}
            aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
          >
            {theme === 'dark' ? <Sun size={14} strokeWidth={1.75} /> : <Moon size={14} strokeWidth={1.75} />}
          </button>
        )}

        <div className="login-form-wrap">
          <div className="login-emblem">
            <BrandMark size={20} />
          </div>
          <h1 className="login-title">Acceso Operativo SGTU</h1>
          <p className="login-subtitle">Consola de supervisión del tránsito urbano de Montevideo.</p>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="segmented stretch" role="tablist" aria-label="Rol de acceso">
              <button
                type="button"
                role="tab"
                aria-selected={selectedRole === 'Operador'}
                className={`segmented-item ${selectedRole === 'Operador' ? 'active' : ''}`}
                onClick={() => applyQuickRole('Operador', 'operador.montevideo', 'urbano2026')}
              >
                Operador Vial
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedRole === 'Administrador'}
                className={`segmented-item ${selectedRole === 'Administrador' ? 'active' : ''}`}
                onClick={() => applyQuickRole('Administrador', 'admin.central', 'admin2026')}
              >
                Administrador
              </button>
            </div>

            {error && (
              <div className="login-alert" role="alert" data-testid="login-error-alert">
                <AlertCircle size={15} strokeWidth={1.75} />
                <div>
                  <div className="login-alert-title">HTTP 401 · CREDENCIALES INVÁLIDAS</div>
                  <div>{error}</div>
                </div>
              </div>
            )}

            <div className="field">
              <label className="field-label" htmlFor="username-input">
                Usuario
              </label>
              <div className="input-wrap">
                <User className="input-icon" size={15} strokeWidth={1.75} />
                <input
                  id="username-input"
                  className="input"
                  type="text"
                  value={username}
                  onChange={(e) => {
                    if (error) clearError();
                    setUsername(e.target.value);
                  }}
                  placeholder="operador.montevideo"
                  required
                  disabled={isLoading}
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="password-input">
                Contraseña
              </label>
              <div className="input-wrap">
                <Lock className="input-icon" size={15} strokeWidth={1.75} />
                <input
                  id="password-input"
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    if (error) clearError();
                    setPassword(e.target.value);
                  }}
                  placeholder="••••••••"
                  required
                  disabled={isLoading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="input-action"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
                </button>
              </div>
            </div>

            <button id="login-submit-btn" type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? (
                <>
                  <span className="spinner" /> Validando credenciales…
                </>
              ) : (
                <>
                  Iniciar sesión <ArrowRight size={15} strokeWidth={1.75} />
                </>
              )}
            </button>
          </form>

          <div className="quickfill">
            <span className="label-caps">Evaluación MVP · Quick Fill</span>
            <div className="quickfill-buttons">
              <button
                type="button"
                className="quickfill-btn"
                onClick={() => applyQuickRole('Operador', 'operador.montevideo', 'urbano2026')}
              >
                Operador válido
              </button>
              <button
                type="button"
                className="quickfill-btn"
                onClick={() => applyQuickRole('Administrador', 'admin.central', 'admin2026')}
              >
                Admin válido
              </button>
              <button
                type="button"
                className="quickfill-btn danger"
                onClick={() => {
                  clearError();
                  setUsername('usuario.no.autorizado');
                  setPassword('invalid');
                }}
              >
                Simular error
              </button>
            </div>
          </div>
        </div>

        <div className="login-legal">
          <span>JWT · HS256</span>
          <span>v0.1.0</span>
        </div>
      </section>

      {/* Right: Unlabeled Charcoal Street Map + Animated Telemetry */}
      <section className="login-visual-col" aria-hidden="true">
        <LoginCharcoalMap />
        <div className="login-visual-vignette" />
        <div className="login-visual-head">
          <span>MONTEVIDEO · 34°54′S 56°11′W</span>
          <span>{INITIAL_INTERSECTIONS_MOCK.length} NODOS CV</span>
        </div>
        <div className="login-visual-watermark">MONTEVIDEO</div>
        <div className="login-visual-caption">
          <h2>Red de visión artificial distribuida</h2>
          <p>
            Workers en contenedores procesan clips de cámaras en paralelo vía RabbitMQ y consolidan
            el estado vial en PostgreSQL.
          </p>
        </div>
        <div className="endpoint-footer">
          {endpoints.map((ep) => (
            <div className="endpoint" key={ep.name}>
              <span className={`status-dot ${ep.state}`} />
              <strong>{ep.name}</strong>
              <span>:{portOf(ep.url)}</span>
              <span className={`endpoint-state ${ep.state}`}>
                {ep.state === 'checking' ? 'CHECKING' : ep.state === 'online' ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
