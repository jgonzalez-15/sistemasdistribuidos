import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Cpu,
  Database,
  HardDrive,
  Layers,
  Pause,
  Play,
  RefreshCw,
  Server,
  ShieldAlert,
  Terminal,
  Trash2,
} from 'lucide-react';
import {
  API_REST_URL,
  AUTH_SERVICE_URL,
  CV_MODULE_URL,
  EDGE_PROCESSOR_URL,
  MONITORING_PIPELINE_URL,
  VISUALIZATION_BACKEND_URL,
} from '../config';

interface SystemBackendViewProps {
  isFaultTolerantDemoMode: boolean;
  onToggleFaultTolerance: () => void;
}

type NodeStatus = 'online' | 'standby' | 'degraded';
type LogSource = 'ALL' | 'API-REST' | 'AUTH-SERVICE' | 'EDGE-PROC' | 'CV-MODULE' | 'RABBITMQ' | 'MONITORING';

interface MicroserviceNode {
  id: string;
  name: string;
  container: string;
  port: number;
  url: string;
  role: string;
  stack: string;
  status: NodeStatus;
  livePing: boolean;
  latencyMs: number;
  replicas: number;
  rps: number;
}

interface QueueMetrics {
  id: string;
  name: string;
  container: string;
  amqpPort: number;
  mgmtPort: number;
  readyMessages: number;
  unackedMessages: number;
  publishRate: number;
  consumeRate: number;
  consumers: number;
  status: 'flowing' | 'retaining';
}

interface StorageMetrics {
  id: string;
  name: string;
  container: string;
  engine: string;
  port: number;
  consolePort?: number;
  databaseOrBucket: string;
  recordsCount: number;
  recordsUnit: string;
  storageSizeMb: number;
  iops: number;
  status: 'online' | 'degraded';
}

interface DistributedLogEntry {
  id: string;
  timestamp: string;
  service: Exclude<LogSource, 'ALL'>;
  level: 'INFO' | 'WARN' | 'ACK';
  queue: 'logs_queue' | 'camera_processing_queue';
  message: string;
}

function formatJoacoTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

const INITIAL_SERVICES: Omit<MicroserviceNode, 'status' | 'livePing' | 'latencyMs'>[] = [
  {
    id: 'api-rest',
    name: 'API REST (BFF)',
    container: 'api-rest',
    port: 8000,
    url: API_REST_URL,
    role: 'Gateway HTTP · Auth & Telemetría',
    stack: 'FastAPI · Pika · Requests',
    replicas: 1,
    rps: 24,
  },
  {
    id: 'edge-processor',
    name: 'Edge Processor',
    container: 'edge-processor',
    port: 8001,
    url: EDGE_PROCESSOR_URL,
    role: 'Captura de Cámaras · Subida S3',
    stack: 'FastAPI · Boto3 · Pika',
    replicas: 2,
    rps: 8,
  },
  {
    id: 'cv-module',
    name: 'CV Module Workers',
    container: 'cv-module',
    port: 8002,
    url: CV_MODULE_URL,
    role: 'Detección Vehicular · Consumidor AMQP',
    stack: 'FastAPI · OpenCV/YOLO · Psycopg2',
    replicas: 3,
    rps: 16,
  },
  {
    id: 'visualization-backend',
    name: 'Visualization Backend',
    container: 'visualization-backend',
    port: 8003,
    url: VISUALIZATION_BACKEND_URL,
    role: 'Series Temporales & Agregación',
    stack: 'FastAPI · Psycopg2 · Boto3',
    replicas: 1,
    rps: 12,
  },
  {
    id: 'monitoring-pipeline',
    name: 'Monitoring Pipeline',
    container: 'monitoring-pipeline',
    port: 8004,
    url: MONITORING_PIPELINE_URL,
    role: 'Consumidor logs_queue · Health',
    stack: 'FastAPI · Pika · Httpx',
    replicas: 1,
    rps: 19,
  },
  {
    id: 'auth-service',
    name: 'Auth Service',
    container: 'auth-service',
    port: 8005,
    url: AUTH_SERVICE_URL,
    role: 'Validación Credenciales & JWT',
    stack: 'FastAPI · Psycopg2 · Pika',
    replicas: 1,
    rps: 5,
  },
];

async function probeHealth(url: string): Promise<{ ok: boolean; latencyMs: number }> {
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 1100);
  try {
    const res = await fetch(`${url}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    const elapsed = Math.max(2, Math.round(performance.now() - t0));
    if (res.ok) {
      return { ok: true, latencyMs: elapsed };
    }
  } catch {
    // Try no-cors reachability check if CORS isn't enabled on a skeleton container yet
    try {
      const c2 = new AbortController();
      const t2 = window.setTimeout(() => c2.abort(), 800);
      await fetch(`${url}/health`, { mode: 'no-cors', signal: c2.signal });
      window.clearTimeout(t2);
      const elapsed = Math.max(3, Math.round(performance.now() - t0));
      return { ok: true, latencyMs: elapsed };
    } catch {
      window.clearTimeout(timer);
    }
  }
  return { ok: false, latencyMs: Math.floor(Math.random() * 9) + 6 };
}

export const SystemBackendView: React.FC<SystemBackendViewProps> = ({
  isFaultTolerantDemoMode,
  onToggleFaultTolerance,
}) => {
  const [services, setServices] = useState<MicroserviceNode[]>(() =>
    INITIAL_SERVICES.map((s) => ({
      ...s,
      status: 'online',
      livePing: s.id === 'api-rest',
      latencyMs: 8,
    }))
  );

  const [queues, setQueues] = useState<QueueMetrics[]>([
    {
      id: 'camera-queue',
      name: 'camera_processing_queue',
      container: 'camera-queue (RabbitMQ #1)',
      amqpPort: 5672,
      mgmtPort: 15672,
      readyMessages: 4,
      unackedMessages: 2,
      publishRate: 8.4,
      consumeRate: 8.2,
      consumers: 3,
      status: 'flowing',
    },
    {
      id: 'logs-queue',
      name: 'logs_queue',
      container: 'logs-queue (RabbitMQ #2)',
      amqpPort: 5673,
      mgmtPort: 15673,
      readyMessages: 1,
      unackedMessages: 1,
      publishRate: 14.6,
      consumeRate: 14.5,
      consumers: 1,
      status: 'flowing',
    },
  ]);

  const [storages, setStorages] = useState<StorageMetrics[]>([
    {
      id: 'auth-db',
      name: 'Auth Database',
      container: 'auth-db',
      engine: 'PostgreSQL 16',
      port: 5433,
      databaseOrBucket: 'auth_db · table: users',
      recordsCount: 12,
      recordsUnit: 'USUARIOS',
      storageSizeMb: 42,
      iops: 14,
      status: 'online',
    },
    {
      id: 'results-db',
      name: 'Results Database',
      container: 'results-db',
      engine: 'PostgreSQL 16',
      port: 5434,
      databaseOrBucket: 'results_db · telemetría vial',
      recordsCount: 18420,
      recordsUnit: 'REGISTROS',
      storageSizeMb: 318,
      iops: 68,
      status: 'online',
    },
    {
      id: 'clips-db',
      name: 'Clips Object Storage',
      container: 'clips-db',
      engine: 'MinIO S3',
      port: 9000,
      consolePort: 9001,
      databaseOrBucket: 's3://clips (video batches)',
      recordsCount: 1284,
      recordsUnit: 'CLIPS MP4',
      storageSizeMb: 4860,
      iops: 31,
      status: 'online',
    },
  ]);

  const [logs, setLogs] = useState<DistributedLogEntry[]>(() => {
    const now = Date.now();
    return [
      {
        id: 'init-1',
        timestamp: formatJoacoTimestamp(new Date(now - 7000)),
        service: 'API-REST',
        level: 'INFO',
        queue: 'logs_queue',
        message: 'Login request received, sending to auth service (POST http://auth-service:8005)',
      },
      {
        id: 'init-2',
        timestamp: formatJoacoTimestamp(new Date(now - 6400)),
        service: 'AUTH-SERVICE',
        level: 'ACK',
        queue: 'logs_queue',
        message: 'Credentials validated against auth-db:5432 (user="admin.central", role="Administrador")',
      },
      {
        id: 'init-3',
        timestamp: formatJoacoTimestamp(new Date(now - 5900)),
        service: 'API-REST',
        level: 'INFO',
        queue: 'logs_queue',
        message: 'Login response received from auth service, sending to frontend',
      },
      {
        id: 'init-4',
        timestamp: formatJoacoTimestamp(new Date(now - 4200)),
        service: 'EDGE-PROC',
        level: 'INFO',
        queue: 'camera_processing_queue',
        message: 'Clip uploaded to MinIO s3://clips/CAM-MVD-101_batch842.mp4 · Enqueued task in camera_processing_queue',
      },
      {
        id: 'init-5',
        timestamp: formatJoacoTimestamp(new Date(now - 2800)),
        service: 'CV-MODULE',
        level: 'ACK',
        queue: 'camera_processing_queue',
        message: 'Worker cv-worker-01 processed CAM-MVD-101 (98 veh, 12 km/h) -> committed to results-db:5434',
      },
      {
        id: 'init-6',
        timestamp: formatJoacoTimestamp(new Date(now - 1200)),
        service: 'MONITORING',
        level: 'INFO',
        queue: 'logs_queue',
        message: 'Consumed 5 log frames from logs-queue:5672 · Cluster heartbeat OK',
      },
    ];
  });

  const [logFilter, setLogFilter] = useState<LogSource>('ALL');
  const [isLogStreamPaused, setIsLogStreamPaused] = useState<boolean>(false);
  const [lastProbeTime, setLastProbeTime] = useState<string>(() => new Date().toLocaleTimeString());
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const logCounterRef = useRef<number>(100);

  const runHealthProbes = useCallback(async () => {
    setIsProbing(true);
    const results = await Promise.all(
      INITIAL_SERVICES.map(async (svc) => {
        const probe = await probeHealth(svc.url);
        const isCvDegraded = isFaultTolerantDemoMode && svc.id === 'cv-module';
        const status: NodeStatus = isCvDegraded
          ? 'degraded'
          : probe.ok
          ? 'online'
          : 'standby';

        return {
          ...svc,
          status,
          livePing: probe.ok && !isCvDegraded,
          latencyMs: isCvDegraded ? 0 : probe.latencyMs,
          replicas: isCvDegraded ? 0 : svc.replicas,
          rps: isCvDegraded ? 0 : Math.max(2, svc.rps + (Math.floor(Math.random() * 5) - 2)),
        };
      })
    );
    setServices(results);
    setLastProbeTime(new Date().toLocaleTimeString());
    setIsProbing(false);
  }, [isFaultTolerantDemoMode]);

  useEffect(() => {
    runHealthProbes();
    const interval = window.setInterval(runHealthProbes, 5000);
    return () => window.clearInterval(interval);
  }, [runHealthProbes]);

  // Live telemetry & log stream ticker
  useEffect(() => {
    const ticker = window.setInterval(() => {
      // Update queue metrics
      setQueues((prev) =>
        prev.map((q) => {
          if (q.id === 'camera-queue') {
            if (isFaultTolerantDemoMode) {
              return {
                ...q,
                readyMessages: q.readyMessages + Math.floor(Math.random() * 6) + 4,
                unackedMessages: 0,
                publishRate: +(8.0 + Math.random() * 1.8).toFixed(1),
                consumeRate: 0.0,
                consumers: 0,
                status: 'retaining',
              };
            }
            const nextReady = Math.max(0, Math.min(9, q.readyMessages + (Math.floor(Math.random() * 5) - 2)));
            const pub = +(7.8 + Math.random() * 1.6).toFixed(1);
            return {
              ...q,
              readyMessages: nextReady,
              unackedMessages: Math.floor(Math.random() * 3) + 1,
              publishRate: pub,
              consumeRate: +(pub + (Math.random() * 0.4 - 0.1)).toFixed(1),
              consumers: 3,
              status: 'flowing',
            };
          }
          // logs-queue
          const pubLogs = +(12.5 + Math.random() * 4.2).toFixed(1);
          return {
            ...q,
            readyMessages: Math.floor(Math.random() * 3),
            unackedMessages: 1,
            publishRate: pubLogs,
            consumeRate: pubLogs,
            consumers: 1,
            status: 'flowing',
          };
        })
      );

      // Update storage counters
      setStorages((prev) =>
        prev.map((st) => {
          if (st.id === 'results-db') {
            return {
              ...st,
              recordsCount: isFaultTolerantDemoMode ? st.recordsCount : st.recordsCount + Math.floor(Math.random() * 8) + 2,
              iops: isFaultTolerantDemoMode ? 12 : 58 + Math.floor(Math.random() * 20),
            };
          }
          if (st.id === 'clips-db') {
            return {
              ...st,
              recordsCount: st.recordsCount + 1,
              storageSizeMb: st.storageSizeMb + 2,
              iops: 26 + Math.floor(Math.random() * 12),
            };
          }
          return st;
        })
      );

      // Append live distributed log entry if not paused
      if (!isLogStreamPaused) {
        logCounterRef.current += 1;
        const seq = logCounterRef.current;
        const cams = ['CAM-MVD-101', 'CAM-MVD-102', 'CAM-MVD-103', 'CAM-MVD-104', 'CAM-MVD-107'];
        const cam = cams[seq % cams.length];
        const ts = formatJoacoTimestamp(new Date());

        let newEntry: DistributedLogEntry;
        if (isFaultTolerantDemoMode) {
          newEntry =
            seq % 2 === 0
              ? {
                  id: `log-${seq}`,
                  timestamp: ts,
                  service: 'RABBITMQ',
                  level: 'WARN',
                  queue: 'camera_processing_queue',
                  message: `Workers cv-module unreachable (0 consumers) · Buffering frame ${cam} in durable queue camera_processing_queue`,
                }
              : {
                  id: `log-${seq}`,
                  timestamp: ts,
                  service: 'API-REST',
                  level: 'INFO',
                  queue: 'logs_queue',
                  message: `Serving last consolidated snapshot from results-db:5434 (Stateless BFF fallback active)`,
                };
        } else {
          const templates: DistributedLogEntry[] = [
            {
              id: `log-${seq}`,
              timestamp: ts,
              service: 'EDGE-PROC',
              level: 'INFO',
              queue: 'camera_processing_queue',
              message: `Frame batch #${seq} from ${cam} stored in MinIO (clips-db:9000) -> published to camera_processing_queue`,
            },
            {
              id: `log-${seq}`,
              timestamp: ts,
              service: 'CV-MODULE',
              level: 'ACK',
              queue: 'camera_processing_queue',
              message: `cv-worker-0${(seq % 3) + 1} ACK frame #${seq} (${cam}) · inference 42ms · INSERT INTO results_db`,
            },
            {
              id: `log-${seq}`,
              timestamp: ts,
              service: 'API-REST',
              level: 'INFO',
              queue: 'logs_queue',
              message: `Message pushed into logs-queue: ([${ts}] GET /api/intersections 200 OK -> 8 nodes)`,
            },
            {
              id: `log-${seq}`,
              timestamp: ts,
              service: 'MONITORING',
              level: 'INFO',
              queue: 'logs_queue',
              message: `Pipeline consumed batch from logs_queue (amqp://logs-queue:5672) · 6/6 microservices healthy`,
            },
            {
              id: `log-${seq}`,
              timestamp: ts,
              service: 'AUTH-SERVICE',
              level: 'ACK',
              queue: 'logs_queue',
              message: `Token JWT HS256 verified for session role="Administrador" against auth-db:5433`,
            },
          ];
          newEntry = templates[seq % templates.length];
        }

        setLogs((prev) => [newEntry, ...prev.slice(0, 39)]);
      }
    }, 2200);

    return () => window.clearInterval(ticker);
  }, [isFaultTolerantDemoMode, isLogStreamPaused]);

  const filteredLogs =
    logFilter === 'ALL' ? logs : logs.filter((entry) => entry.service === logFilter);

  const onlineServicesCount = services.filter((s) => s.status !== 'degraded').length;
  const totalReadyQueued = queues.reduce((acc, q) => acc + q.readyMessages, 0);

  return (
    <main className="sys-workspace" aria-label="Panel de estado del backend distribuido">
      {/* Top operational subheader */}
      <div className="sys-subheader">
        <div className="sys-subheader-left">
          <span className="sys-admin-badge">ADMIN ONLY · BACKEND TELEMETRY</span>
          <h1 className="sys-title">Topología y Estado del Sistema Distribuido</h1>
          <span className="sys-subtitle">
            docker-compose · red <code>distributed_net</code> · 11 contenedores
          </span>
        </div>

        <div className="sys-subheader-right">
          <div className="sys-summary-pills">
            <span className="sys-stat-pill">
              <span className={`status-dot ${isFaultTolerantDemoMode ? 'moderado' : 'fluido'}`} />
              SERVICIOS <strong>{onlineServicesCount}/6</strong>
            </span>
            <span className="sys-stat-pill">
              <span className="status-dot fluido" />
              COLAS AMQP <strong>2/2</strong> ({totalReadyQueued} MSG)
            </span>
            <span className="sys-stat-pill">
              <span className="status-dot fluido" />
              STORAGE <strong>3/3</strong>
            </span>
          </div>

          <button
            type="button"
            className={`sim-btn ${isFaultTolerantDemoMode ? 'active danger' : ''}`}
            onClick={onToggleFaultTolerance}
            id="btn-sys-fault-toggle"
            title="Simular caída del pool de workers cv-module para observar cómo camera_processing_queue retiene los eventos sin pérdida"
          >
            <ShieldAlert size={14} strokeWidth={1.75} />
            <span>
              {isFaultTolerantDemoMode ? 'Restaurar Workers CV' : 'Simular Caída Workers CV'}
            </span>
          </button>

          <button
            type="button"
            className="sim-btn primary"
            onClick={runHealthProbes}
            disabled={isProbing}
            id="btn-sys-probe"
          >
            <RefreshCw size={14} strokeWidth={1.75} />
            <span>Ping /health ({lastProbeTime})</span>
          </button>
        </div>
      </div>

      <div className="sys-content">
        {/* SECTION 1: END-TO-END PIPELINE TOPOLOGY */}
        <section className="sys-section" aria-label="Flujo de arquitectura y topología">
          <div className="sys-section-head">
            <div className="sys-section-title">
              <Layers size={15} strokeWidth={1.75} />
              <span>1. Pipeline de Procesamiento y Flujo entre Contenedores</span>
            </div>
            <span className="sys-section-meta">
              INGESTA EDGE → COLA RABBITMQ → WORKERS CV → POSTGRESQL / S3 → BFF FASTAPI
            </span>
          </div>

          <div className="sys-pipeline-flow">
            {/* Stage 1: Ingestion */}
            <div className="sys-flow-stage">
              <div className="sys-stage-label">01 · INGESTA EDGE</div>
              <div className="sys-flow-node">
                <div className="sys-flow-node-top">
                  <span className="status-dot fluido" />
                  <code>edge-processor</code>
                  <span className="sys-port">:8001</span>
                </div>
                <div className="sys-flow-node-desc">Captura frames y sube MP4 a MinIO</div>
              </div>
              <div className="sys-flow-node storage">
                <div className="sys-flow-node-top">
                  <HardDrive size={12} strokeWidth={1.75} />
                  <code>clips-db (MinIO S3)</code>
                  <span className="sys-port">:9000</span>
                </div>
                <div className="sys-flow-node-desc">Bucket s3://clips ({storages[2].recordsCount} clips)</div>
              </div>
            </div>

            <div className="sys-flow-arrow">
              <span className="sys-flow-protocol">AMQP :5672</span>
              <ArrowRight size={16} strokeWidth={1.75} />
            </div>

            {/* Stage 2: Message Broker 1 */}
            <div className="sys-flow-stage">
              <div className="sys-stage-label">02 · BROKER DE EVENTOS</div>
              <div className={`sys-flow-node queue ${isFaultTolerantDemoMode ? 'warning' : ''}`}>
                <div className="sys-flow-node-top">
                  <span className={`status-dot ${isFaultTolerantDemoMode ? 'moderado' : 'fluido'}`} />
                  <code>camera-queue</code>
                  <span className="sys-port">:5672</span>
                </div>
                <div className="sys-flow-node-desc">
                  Queue: <code>camera_processing_queue</code>
                </div>
                <div className="sys-flow-badge">
                  {queues[0].readyMessages} READY · {queues[0].publishRate} msg/s
                </div>
              </div>
            </div>

            <div className={`sys-flow-arrow ${isFaultTolerantDemoMode ? 'paused' : ''}`}>
              <span className="sys-flow-protocol">
                {isFaultTolerantDemoMode ? 'PAUSED (0 ACK)' : '3 WORKERS'}
              </span>
              <ArrowRight size={16} strokeWidth={1.75} />
            </div>

            {/* Stage 3: CV Workers & Persistence */}
            <div className="sys-flow-stage">
              <div className="sys-stage-label">03 · CÓMPUTO CV & PERSISTENCIA</div>
              <div className={`sys-flow-node ${isFaultTolerantDemoMode ? 'degraded' : ''}`}>
                <div className="sys-flow-node-top">
                  <span className={`status-dot ${isFaultTolerantDemoMode ? 'congestionado' : 'fluido'}`} />
                  <code>cv-module</code>
                  <span className="sys-port">:8002</span>
                </div>
                <div className="sys-flow-node-desc">
                  {isFaultTolerantDemoMode
                    ? 'Workers detenidos (simulando fallo)'
                    : 'Inferencia YOLO · Conteo vehicular'}
                </div>
              </div>
              <div className="sys-flow-node storage">
                <div className="sys-flow-node-top">
                  <Database size={12} strokeWidth={1.75} />
                  <code>results-db (PG 16)</code>
                  <span className="sys-port">:5434</span>
                </div>
                <div className="sys-flow-node-desc">
                  {storages[1].recordsCount.toLocaleString()} registros consolidados
                </div>
              </div>
            </div>

            <div className="sys-flow-arrow">
              <span className="sys-flow-protocol">SQL / HTTP</span>
              <ArrowRight size={16} strokeWidth={1.75} />
            </div>

            {/* Stage 4: BFF, Auth & Visualization */}
            <div className="sys-flow-stage">
              <div className="sys-stage-label">04 · CAPA BFF & ACCESO</div>
              <div className="sys-flow-node highlight">
                <div className="sys-flow-node-top">
                  <span className="status-dot fluido" />
                  <code>api-rest (BFF)</code>
                  <span className="sys-port">:8000</span>
                </div>
                <div className="sys-flow-node-desc">POST /login · GET /api/intersections</div>
              </div>
              <div className="sys-flow-subrow">
                <div className="sys-flow-mini">
                  <code>auth-service :8005</code> + <code>auth-db :5433</code>
                </div>
                <div className="sys-flow-mini">
                  <code>visualization-backend :8003</code>
                </div>
              </div>
            </div>

            <div className="sys-flow-arrow">
              <span className="sys-flow-protocol">AMQP :5673</span>
              <ArrowRight size={16} strokeWidth={1.75} />
            </div>

            {/* Stage 5: Observability */}
            <div className="sys-flow-stage">
              <div className="sys-stage-label">05 · OBSERVABILIDAD</div>
              <div className="sys-flow-node queue">
                <div className="sys-flow-node-top">
                  <span className="status-dot fluido" />
                  <code>logs-queue</code>
                  <span className="sys-port">:5673</span>
                </div>
                <div className="sys-flow-node-desc">
                  Queue: <code>logs_queue</code> ({queues[1].publishRate} msg/s)
                </div>
              </div>
              <div className="sys-flow-node">
                <div className="sys-flow-node-top">
                  <span className="status-dot fluido" />
                  <code>monitoring-pipeline</code>
                  <span className="sys-port">:8004</span>
                </div>
                <div className="sys-flow-node-desc">Agregador de logs y métricas</div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: 6 MICROSERVICES HEALTH CARDS */}
        <section className="sys-section" aria-label="Estado de los 6 microservicios FastAPI">
          <div className="sys-section-head">
            <div className="sys-section-title">
              <Server size={15} strokeWidth={1.75} />
              <span>2. Microservicios de Aplicación (FastAPI Containers)</span>
            </div>
            <span className="sys-section-meta"> PUERTOS 8000 — 8005 · HEALTHCHECKS EN VIVO</span>
          </div>

          <div className="sys-services-grid">
            {services.map((svc) => {
              const dotClass =
                svc.status === 'degraded'
                  ? 'congestionado'
                  : svc.status === 'online'
                  ? 'fluido'
                  : 'fluido';
              return (
                <article
                  key={svc.id}
                  className={`sys-service-card ${svc.status}`}
                  data-testid={`sys-service-${svc.id}`}
                >
                  <div className="sys-card-top">
                    <div className="sys-card-id">
                      <span className={`status-dot ${dotClass}`} />
                      <code>{svc.container}</code>
                      <span className="sys-port-tag">:{svc.port}</span>
                    </div>
                    <span className={`sys-status-chip ${svc.status}`}>
                      {svc.status === 'degraded'
                        ? 'PAUSADO'
                        : svc.livePing
                        ? 'HTTP 200 · LIVE'
                        : 'ONLINE · SIM'}
                    </span>
                  </div>

                  <div className="sys-card-name">{svc.name}</div>
                  <div className="sys-card-role">{svc.role}</div>

                  <div className="sys-card-metrics">
                    <div>
                      <span className="label-caps">Latencia</span>
                      <strong>{svc.status === 'degraded' ? '—' : `${svc.latencyMs} ms`}</strong>
                    </div>
                    <div>
                      <span className="label-caps">Workers</span>
                      <strong>{svc.replicas} inst.</strong>
                    </div>
                    <div>
                      <span className="label-caps">Throughput</span>
                      <strong>{svc.rps} req/s</strong>
                    </div>
                  </div>

                  <div className="sys-card-foot">
                    <span>{svc.stack}</span>
                    <code>GET /health</code>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* SECTION 3: RABBITMQ BROKERS + DATABASES / S3 */}
        <div className="sys-two-col">
          {/* Left: 2 RabbitMQ Instances */}
          <section className="sys-section" aria-label="Colas RabbitMQ">
            <div className="sys-section-head">
              <div className="sys-section-title">
                <Cpu size={15} strokeWidth={1.75} />
                <span>3. Brokers de Mensajería (RabbitMQ 3.13)</span>
              </div>
              <span className="sys-section-meta">AMQP :5672 / :5673</span>
            </div>

            <div className="sys-stack-list">
              {queues.map((q) => (
                <article
                  key={q.id}
                  className={`sys-queue-card ${q.status === 'retaining' ? 'retaining' : ''}`}
                  data-testid={`sys-queue-${q.id}`}
                >
                  <div className="sys-queue-head">
                    <div>
                      <div className="sys-queue-title">
                        <span
                          className={`status-dot ${
                            q.status === 'retaining' ? 'moderado' : 'fluido'
                          }`}
                        />
                        <code>{q.name}</code>
                      </div>
                      <div className="sys-queue-sub">
                        {q.container} · AMQP <code>:{q.amqpPort}</code> · Mgmt UI{' '}
                        <code>:{q.mgmtPort}</code>
                      </div>
                    </div>
                    <span className={`sys-status-chip ${q.status}`}>
                      {q.status === 'retaining' ? 'RETENIENDO EN COLA' : 'FLUJO ACTIVO'}
                    </span>
                  </div>

                  <div className="sys-queue-kpis">
                    <div className="sys-queue-kpi">
                      <span className="label-caps">En Cola (Ready)</span>
                      <strong className={q.readyMessages > 15 ? 'c-moderate' : ''}>
                        {q.readyMessages}
                      </strong>
                    </div>
                    <div className="sys-queue-kpi">
                      <span className="label-caps">Unacked</span>
                      <strong>{q.unackedMessages}</strong>
                    </div>
                    <div className="sys-queue-kpi">
                      <span className="label-caps">Publicación</span>
                      <strong>{q.publishRate} msg/s</strong>
                    </div>
                    <div className="sys-queue-kpi">
                      <span className="label-caps">Consumo</span>
                      <strong className={q.consumeRate === 0 ? 'c-critical' : 'c-fluid'}>
                        {q.consumeRate} msg/s
                      </strong>
                    </div>
                    <div className="sys-queue-kpi">
                      <span className="label-caps">Consumidores</span>
                      <strong>{q.consumers}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* Right: 3 Storage Engines */}
          <section className="sys-section" aria-label="Bases de datos y almacenamiento S3">
            <div className="sys-section-head">
              <div className="sys-section-title">
                <Database size={15} strokeWidth={1.75} />
                <span>4. Persistencia Aislada (PostgreSQL 16 & MinIO S3)</span>
              </div>
              <span className="sys-section-meta">PUERTOS :5433 · :5434 · :9000</span>
            </div>

            <div className="sys-stack-list">
              {storages.map((st) => (
                <article key={st.id} className="sys-storage-card" data-testid={`sys-storage-${st.id}`}>
                  <div className="sys-queue-head">
                    <div>
                      <div className="sys-queue-title">
                        <span className="status-dot fluido" />
                        <code>{st.container}</code>
                        <span className="sys-engine-badge">{st.engine}</span>
                      </div>
                      <div className="sys-queue-sub">
                        {st.databaseOrBucket} · Puerto <code>:{st.port}</code>
                        {st.consolePort ? ` (Console :${st.consolePort})` : ''}
                      </div>
                    </div>
                    <span className="sys-status-chip online">ONLINE</span>
                  </div>

                  <div className="sys-storage-kpis">
                    <div className="sys-queue-kpi">
                      <span className="label-caps">{st.recordsUnit}</span>
                      <strong>{st.recordsCount.toLocaleString()}</strong>
                    </div>
                    <div className="sys-queue-kpi">
                      <span className="label-caps">Volumen</span>
                      <strong>{st.storageSizeMb} MB</strong>
                    </div>
                    <div className="sys-queue-kpi">
                      <span className="label-caps">Operaciones</span>
                      <strong>{st.iops} IOPS</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        {/* SECTION 4: LIVE DISTRIBUTED LOG STREAM (logs_queue) */}
        <section className="sys-section sys-logs-section" aria-label="Stream de logs distribuidos">
          <div className="sys-section-head">
            <div className="sys-section-title">
              <Terminal size={15} strokeWidth={1.75} />
              <span>5. Stream de Logs Distribuidos en Vivo (RabbitMQ · logs_queue :5673)</span>
            </div>

            <div className="sys-log-controls">
              <div className="segmented small" role="tablist" aria-label="Filtrar logs por servicio">
                {(
                  ['ALL', 'API-REST', 'AUTH-SERVICE', 'EDGE-PROC', 'CV-MODULE', 'RABBITMQ', 'MONITORING'] as LogSource[]
                ).map((source) => (
                  <button
                    key={source}
                    type="button"
                    role="tab"
                    aria-selected={logFilter === source}
                    className={`segmented-item ${logFilter === source ? 'active' : ''}`}
                    onClick={() => setLogFilter(source)}
                  >
                    {source === 'ALL' ? 'Todos' : source}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="sim-btn"
                onClick={() => setIsLogStreamPaused((p) => !p)}
                title={isLogStreamPaused ? 'Reanudar stream' : 'Pausar stream'}
              >
                {isLogStreamPaused ? <Play size={13} strokeWidth={1.75} /> : <Pause size={13} strokeWidth={1.75} />}
                <span>{isLogStreamPaused ? 'Reanudar' : 'Pausar'}</span>
              </button>

              <button
                type="button"
                className="sim-btn"
                onClick={() => setLogs([])}
                title="Limpiar consola"
              >
                <Trash2 size={13} strokeWidth={1.75} />
              </button>
            </div>
          </div>

          <div className="sys-terminal" data-testid="sys-log-terminal">
            {filteredLogs.length === 0 ? (
              <div className="sys-terminal-empty">
                SIN EVENTOS EN COLA PARA EL FILTRO SELECCIONADO ({logFilter})
              </div>
            ) : (
              filteredLogs.map((entry) => (
                <div key={entry.id} className={`sys-log-line level-${entry.level.toLowerCase()}`}>
                  <span className="sys-log-time">[{entry.timestamp}]</span>
                  <span className={`sys-log-svc svc-${entry.service.toLowerCase()}`}>
                    {entry.service}
                  </span>
                  <span className="sys-log-queue">{entry.queue}</span>
                  <span className="sys-log-msg">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
};
