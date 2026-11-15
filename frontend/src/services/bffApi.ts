import { API_REST_URL } from '../config';
import {
  IntersectionAnalyticsDetail,
  IntersectionSummary,
  LoginCredentials,
  TimeSeriesPoint,
  UserRole,
  UserSession,
} from '../types/traffic';
import {
  buildMockAnalyticsDetail,
  computeCongestionLevel,
  CONCURRENT_CONGESTION_PRESET,
  createInitialTimeSeriesMap,
  formatRealTimeLabel,
  INITIAL_INTERSECTIONS_MOCK,
} from '../mocks/trafficMockData';

const STORAGE_TOKEN_KEY = 'sd_urbano_jwt_token';
const STORAGE_SESSION_KEY = 'sd_urbano_user_session';

// In-memory state for live simulation so updates and historical points persist across route changes
let currentIntersectionsState: IntersectionSummary[] = [...INITIAL_INTERSECTIONS_MOCK];
let currentTimeSeriesById: Record<string, TimeSeriesPoint[]> = createInitialTimeSeriesMap();
let hasLocalSimulationUpdates = false;

/**
 * Generates a realistic-looking mock JWT token with encoded header and payload.
 */
function generateMockJwt(username: string, role: UserRole): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      sub: username,
      role,
      iss: 'fastapi-bff-urban-traffic',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  );
  const signature = 'mock_sig_9f8a7b6c5d4e3f2a1b0c';
  return `${header}.${payload}.${signature}`;
}

function normalizeBackendRole(backendRole?: string, fallbackRole?: UserRole): UserRole {
  const normalized = (backendRole || '').trim().toLowerCase();
  if (normalized === 'admin' || normalized === 'administrador') {
    return 'Administrador';
  }
  if (normalized === 'user' || normalized === 'operador') {
    return 'Operador';
  }
  return fallbackRole || 'Operador';
}

/**
 * 1. Servicio de Autenticación (POST /login en API REST -> auth-service)
 * Valida credenciales reales contra auth-service/auth-db. Si el backend responde 401/403/422,
 * propaga el error real. Solo cae al modo mock si el backend no está accesible.
 */
export async function loginWithBff(credentials: LoginCredentials): Promise<UserSession> {
  const { username, password, role } = credentials;
  const normalizedUser = username.trim().toLowerCase();

  if (!normalizedUser || !password) {
    throw new Error('Debe ingresar usuario y contraseña.');
  }

  let backendReachable = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

    const response = await fetch(`${API_REST_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: normalizedUser,
        username: normalizedUser,
        password,
        role,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    backendReachable = true;

    const data = await response.json().catch(() => null);
    if (response.ok && data && (data.access_token || data.token)) {
      const session: UserSession = {
        username: data.username || data.user || username.trim(),
        role: normalizeBackendRole(data.role, role),
        token: data.access_token || data.token,
        issuedAt: new Date().toLocaleTimeString(),
      };
      saveSession(session);
      return session;
    }

    if (!response.ok) {
      throw new Error(
        (data && data.detail) ||
          'Credenciales inválidas: El usuario o la contraseña no coinciden con los registros de Auth-DB.'
      );
    }
  } catch (err) {
    if (backendReachable) {
      throw err;
    }
    // Fallback to simulated BFF JWT response only when api-rest is unreachable
  }

  await new Promise((resolve) => setTimeout(resolve, 400));
  if (password.length < 4 || password === 'invalid' || password === 'error') {
    throw new Error(
      'Credenciales inválidas (modo offline): verifique usuario y contraseña.'
    );
  }

  const assignedRole: UserRole =
    role || (normalizedUser.includes('admin') ? 'Administrador' : 'Operador');

  const session: UserSession = {
    username: username.trim(),
    role: assignedRole,
    token: generateMockJwt(username.trim(), assignedRole),
    issuedAt: new Date().toLocaleTimeString(),
  };

  saveSession(session);
  return session;
}

export function saveSession(session: UserSession): void {
  localStorage.setItem(STORAGE_TOKEN_KEY, session.token);
  localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(session));
}

export function getStoredSession(): UserSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserSession;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  localStorage.removeItem(STORAGE_SESSION_KEY);
}

export async function logoutFromBff(): Promise<void> {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY);
  clearSession();
  if (!token) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    await fetch(`${API_REST_URL}/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // Session already cleared locally if BFF is offline
  }
}

/**
 * 2. Recuperación de Estado Actual de las Vías (GET /api/intersections en BFF FastAPI)
 * Envía el JWT en la cabecera Authorization: Bearer <token>.
 */
export async function fetchIntersectionsFromBff(options?: {
  forceLive?: boolean;
}): Promise<{
  data: IntersectionSummary[];
  source: 'bff-live' | 'bff-mock-fallback';
}> {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY);

  if (options?.forceLive) {
    hasLocalSimulationUpdates = false;
  }

  if (!hasLocalSimulationUpdates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);

      const response = await fetch(`${API_REST_URL}/api/intersections`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const realData = await response.json();
        if (Array.isArray(realData) && realData.length > 0) {
          currentIntersectionsState = realData;
          return { data: realData, source: 'bff-live' };
        }
      }
    } catch {
      // Expected when evaluating frontend standalone or with skeleton backend
    }
  }

  return {
    data: [...currentIntersectionsState],
    source: 'bff-mock-fallback',
  };
}

/**
 * 3. Serie Temporal Histórica por Intersección (GET /api/intersections/:id/history en BFF FastAPI)
 */
export async function fetchIntersectionAnalyticsFromBff(
  intersectionId: string,
  _options?: { fastRefresh?: boolean }
): Promise<IntersectionAnalyticsDetail> {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY);

  // Si el usuario abrió la vista dividida con un ID mock (ej. int-001) pero el backend real
  // usa IDs D4 (int-1, int-2, int-3), resolvemos automáticamente al ID equivalente.
  let resolvedId = intersectionId;
  if (
    currentIntersectionsState.length > 0 &&
    !currentIntersectionsState.some((i) => i.id === intersectionId)
  ) {
    const numMatch = intersectionId.match(/^int-0*(\d+)$/);
    const candidateId = numMatch ? `int-${numMatch[1]}` : null;
    if (candidateId && currentIntersectionsState.some((i) => i.id === candidateId)) {
      resolvedId = candidateId;
    } else {
      resolvedId = currentIntersectionsState[0].id;
    }
  }

  if (!hasLocalSimulationUpdates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);

      const response = await fetch(
        `${API_REST_URL}/api/intersections/${encodeURIComponent(resolvedId)}/history`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);
      if (response.ok) {
        const realDetail = await response.json();
        if (realDetail && realDetail.intersection && Array.isArray(realDetail.timeSeries)) {
          return realDetail as IntersectionAnalyticsDetail;
        }
      }
    } catch {
      // Fallback to structured time-series mock when backend is offline
    }
  }

  const found =
    currentIntersectionsState.find((i) => i.id === resolvedId) ||
    currentIntersectionsState[0];

  const series = currentTimeSeriesById[found.id];

  return buildMockAnalyticsDetail(found, series);
}

/**
 * 4. Salud agregada de microservicios (GET /api/system/health - solo Administrador)
 */
export async function fetchSystemHealthFromBff(): Promise<Record<string, any> | null> {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY);
  if (!token) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const response = await fetch(`${API_REST_URL}/api/system/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      return data?.services || null;
    }
  } catch {
    // Backend unavailable
  }
  return null;
}

/**
 * Helper que agrega un nuevo punto con la hora real actual al historial de cada cámara
 * sin sobreescribir las horas anteriores (mantiene los últimos 14 puntos para legibilidad).
 * Si llegan múltiples batches dentro del mismo segundo exacto, consolida ese último segundo
 * sin duplicar columnas ni claves en la gráfica.
 */
function appendRealTimePointToHistory(
  intersectionId: string,
  vehicles: number,
  now: Date
): void {
  const existing = currentTimeSeriesById[intersectionId] || [];
  const labelHHMM = formatRealTimeLabel(now, false);
  const labelHHMMSS = formatRealTimeLabel(now, true);

  const lastPoint = existing[existing.length - 1];
  const pointLabel =
    lastPoint && (lastPoint.hour === labelHHMM || lastPoint.hour.startsWith(labelHHMM))
      ? labelHHMMSS
      : labelHHMM;

  const newPoint: TimeSeriesPoint = {
    hour: pointLabel,
    timestamp: now.toISOString(),
    vehicles,
    thresholdCongestion: 75,
    thresholdModerate: 40,
  };

  // Si ya existe un punto exactamente para este segundo HH:MM:SS, actualizarlo en lugar de apilar duplicados
  const updatedSeries =
    lastPoint && lastPoint.hour === pointLabel
      ? [...existing.slice(0, -1), newPoint]
      : [...existing, newPoint];

  // Conservamos hasta 14 puntos en el gráfico para que no se encimen las etiquetas
  currentTimeSeriesById[intersectionId] =
    updatedSeries.length > 14 ? updatedSeries.slice(updatedSeries.length - 14) : updatedSeries;
}

/**
 * Utilidades de simulación para la defensa oral (Procesamiento Concurrente y Tráfico Dinámico)
 */
export function triggerConcurrentCongestionSimulation(): IntersectionSummary[] {
  hasLocalSimulationUpdates = true;
  const now = new Date();
  const realTimeStr = formatRealTimeLabel(now, true);

  currentIntersectionsState = CONCURRENT_CONGESTION_PRESET.map((item) => {
    appendRealTimePointToHistory(item.id, item.vehicleCount, now);
    return {
      ...item,
      lastUpdated: `${realTimeStr} hs (Paralelo < 1s)`,
    };
  });

  return [...currentIntersectionsState];
}

export function resetNormalTrafficSimulation(): IntersectionSummary[] {
  hasLocalSimulationUpdates = true;
  const now = new Date();
  const realTimeStr = formatRealTimeLabel(now, false);

  currentTimeSeriesById = createInitialTimeSeriesMap();
  currentIntersectionsState = INITIAL_INTERSECTIONS_MOCK.map((item) => ({
    ...item,
    lastUpdated: `${realTimeStr} hs`,
  }));

  return [...currentIntersectionsState];
}

export function simulateNextWorkerBatchUpdate(): IntersectionSummary[] {
  hasLocalSimulationUpdates = true;
  const now = new Date();
  const realTimeStr = formatRealTimeLabel(now, true);

  currentIntersectionsState = currentIntersectionsState.map((item) => {
    const baseline =
      INITIAL_INTERSECTIONS_MOCK.find((m) => m.id === item.id)?.vehicleCount ?? 50;
    // Simetric random fluctuation [-12, +12] (zero bias) plus gentle mean reversion
    // so counts rise and fall naturally instead of drifting monotonically upward.
    const randomStep = Math.floor(Math.random() * 25) - 12;
    const meanReversion = Math.round((baseline - item.vehicleCount) * 0.12);
    const delta = randomStep + meanReversion;
    const nextCount = Math.max(8, Math.min(item.maxCapacity, item.vehicleCount + delta));
    const nextStatus = computeCongestionLevel(nextCount);
    const nextSpeed =
      nextStatus === 'congestionado'
        ? Math.max(8, Math.min(18, 22 - Math.floor(nextCount / 10)))
        : nextStatus === 'moderado'
        ? 34
        : 50;

    appendRealTimePointToHistory(item.id, nextCount, now);

    return {
      ...item,
      vehicleCount: nextCount,
      status: nextStatus,
      lastUpdated: `${realTimeStr} hs (RabbitMQ)`,
      averageSpeedKmh: nextSpeed,
    };
  });

  return [...currentIntersectionsState];
}
