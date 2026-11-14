import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/traffic';
import { API_REST_URL, AUTH_SERVICE_URL } from '../config';
import { INITIAL_INTERSECTIONS_MOCK } from '../mocks/trafficMockData';
import { BrandMark } from './Header';

interface LoginViewProps {
  onLoginSuccess: () => void;
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

/* ---------- Atmospheric Montevideo vector canvas ---------- */
const BOUNDS = { latTop: -34.848, latBottom: -34.93, lngLeft: -56.222, lngRight: -56.108 };
const VB = 800;

function project([lat, lng]: [number, number]): [number, number] {
  const x = ((lng - BOUNDS.lngLeft) / (BOUNDS.lngRight - BOUNDS.lngLeft)) * VB;
  const y = ((BOUNDS.latTop - lat) / (BOUNDS.latTop - BOUNDS.latBottom)) * VB;
  return [x, y];
}

function toPath(points: [number, number][]): string {
  return points
    .map((p, i) => {
      const [x, y] = project(p);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const AVENUES: { id: string; color: string; pts: [number, number][]; slow?: boolean; reverse?: boolean }[] = [
  { id: '18julio', color: '#EF4444', pts: [[-34.9068, -56.2125], [-34.9057, -56.1869], [-34.9010, -56.1740], [-34.8949, -56.1650], [-34.8915, -56.1420], [-34.8880, -56.1150]] },
  { id: 'artigas', color: '#F59E0B', pts: [[-34.9148, -56.1628], [-34.9050, -56.1640], [-34.8949, -56.1650], [-34.8840, -56.1700], [-34.8700, -56.1790], [-34.8560, -56.1870]], reverse: true },
  { id: 'rivera', color: '#10B981', pts: [[-34.9040, -56.1790], [-34.9020, -56.1600], [-34.9012, -56.1385], [-34.8985, -56.1180]], slow: true },
  { id: '8oct', color: '#EF4444', pts: [[-34.8949, -56.1650], [-34.8870, -56.1560], [-34.8793, -56.1479], [-34.8680, -56.1330], [-34.8590, -56.1180]] },
  { id: 'agraciada', color: '#F59E0B', pts: [[-34.9030, -56.2050], [-34.8960, -56.1960], [-34.8899, -56.1874], [-34.8780, -56.1900], [-34.8664, -56.1923], [-34.8520, -56.2010]], slow: true },
  { id: 'italia', color: '#3B82F6', pts: [[-34.8949, -56.1650], [-34.8960, -56.1450], [-34.8975, -56.1250], [-34.8990, -56.1100]], reverse: true },
];

const COAST: [number, number][] = [
  [-34.9035, -56.2220], [-34.9095, -56.2120], [-34.9110, -56.2000], [-34.9135, -56.1880],
  [-34.9175, -56.1760], [-34.9210, -56.1660], [-34.9195, -56.1560], [-34.9140, -56.1500],
  [-34.9103, -56.1441], [-34.9080, -56.1340], [-34.9050, -56.1220], [-34.9020, -56.1080],
];

const AtmosphericCanvas: React.FC = () => {
  const coastPath = useMemo(() => toPath(COAST), []);
  const nodes = useMemo(
    () => INITIAL_INTERSECTIONS_MOCK.map((n) => ({ id: n.id, code: n.cameraCode, status: n.status, xy: project(n.coordinates) })),
    []
  );

  return (
    <svg className="login-visual-svg" viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={VB} height={VB} fill="url(#grid)" />

      {/* Coastline contours (topographic offset) */}
      {[0, 14, 28, 44, 62].map((offset, i) => (
        <path
          key={offset}
          d={coastPath}
          transform={`translate(0 ${offset})`}
          fill="none"
          stroke="rgba(255,255,255,1)"
          strokeOpacity={0.12 - i * 0.022}
          strokeWidth="1"
        />
      ))}

      {/* Avenue base strokes */}
      {AVENUES.map((a) => (
        <path key={`base-${a.id}`} d={toPath(a.pts)} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="1.25" strokeLinejoin="round" />
      ))}

      {/* Animated low-opacity flows */}
      {AVENUES.map((a) => (
        <path
          key={`flow-${a.id}`}
          d={toPath(a.pts)}
          className={`flow-line ${a.slow ? 'slow' : ''} ${a.reverse ? 'reverse' : ''}`}
          stroke={a.color}
          strokeOpacity="0.55"
          strokeWidth="1.75"
        />
      ))}

      {/* Monitored nodes */}
      {nodes.map((n, i) => {
        const color = n.status === 'congestionado' ? '#EF4444' : n.status === 'moderado' ? '#F59E0B' : '#10B981';
        return (
          <g key={n.id}>
            <circle
              className="node-ring"
              cx={n.xy[0]}
              cy={n.xy[1]}
              r="6"
              fill="none"
              stroke={color}
              strokeOpacity="0.6"
              style={{ animationDelay: `${i * 0.32}s` }}
            />
            <circle cx={n.xy[0]} cy={n.xy[1]} r="2.5" fill={color} />
            <text x={n.xy[0] + 9} y={n.xy[1] + 3} fontSize="9" fill="rgba(255,255,255,0.28)">
              {n.code}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
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

  const endpoints: { name: string; url: string; state: EndpointState }[] = [
    { name: 'API REST', url: API_REST_URL, state: apiState },
    { name: 'AUTH SERVICE', url: AUTH_SERVICE_URL, state: authState },
  ];

  return (
    <div className="login-shell">
      {/* Left: form */}
      <section className="login-form-col">
        <div className="login-top-brand">
          <BrandMark size={16} />
          SGTU<span className="sep"> // </span>MONTEVIDEO
        </div>

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

      {/* Right: atmospheric canvas */}
      <section className="login-visual-col" aria-hidden="true">
        <AtmosphericCanvas />
        <div className="login-visual-vignette" />
        <div className="login-visual-head">
          <span>MONTEVIDEO · 34°54′S 56°11′W</span>
          <span>{INITIAL_INTERSECTIONS_MOCK.length} NODOS CV</span>
        </div>
        <div className="login-visual-caption">
          <h2>Red de visión artificial distribuida</h2>
          <p>Workers en contenedores procesan clips de cámaras en paralelo vía RabbitMQ y consolidan el estado vial en PostgreSQL.</p>
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
