import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pause,
  Play,
  Send,
  ShieldAlert,
  Terminal,
  Trash2,
  Zap,
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

type NodeId =
  | 'frontend'
  | 'api-rest'
  | 'auth-service'
  | 'auth-db'
  | 'visualization-backend'
  | 'edge-processor'
  | 'clips-db'
  | 'camera-queue'
  | 'cv-module'
  | 'results-db'
  | 'logs-queue'
  | 'monitoring-pipeline';

type NodeKind = 'client' | 'service' | 'broker' | 'database' | 'object-store';
type LogSource = 'ALL' | 'API-REST' | 'AUTH-SERVICE' | 'EDGE-PROC' | 'CV-MODULE' | 'RABBITMQ' | 'MONITORING';

interface DiagramNodeSpec {
  id: NodeId;
  title: string;
  container: string;
  port: string;
  kind: NodeKind;
  zone: string;
  tech: string;
  role: string;
  url?: string;
  /** SVG center coordinates on a 1260 x 590 canvas */
  cx: number;
  cy: number;
}

interface DiagramLinkSpec {
  id: string;
  from: NodeId;
  to: NodeId;
  protocol: string;
  color: string;
  /** Optional control point offset for curved SVG Bezier path */
  curveOffset?: [number, number];
}

interface InFlightPacket {
  id: string;
  linkId: string;
  from: NodeId;
  to: NodeId;
  label: string;
  color: string;
  startedAt: number;
  durationMs: number;
}

interface DistributedLogEntry {
  id: string;
  timestamp: string;
  service: Exclude<LogSource, 'ALL'>;
  level: 'INFO' | 'WARN' | 'ACK';
  queue: 'logs_queue' | 'camera_processing_queue';
  message: string;
}

const DIAGRAM_NODES: DiagramNodeSpec[] = [
  // Row 1: Client / BFF / Auth Plane
  {
    id: 'frontend',
    title: 'React SPA Console',
    container: 'frontend',
    port: ':3000',
    kind: 'client',
    zone: 'CLIENT TIER',
    tech: 'React 18 · Vite · Leaflet',
    role: 'Consola web de supervisión urbana y telemetría',
    cx: 130,
    cy: 96,
  },
  {
    id: 'api-rest',
    title: 'API REST (BFF)',
    container: 'api-rest',
    port: ':8000',
    kind: 'service',
    zone: 'GATEWAY / BFF',
    tech: 'FastAPI · Pika · Requests',
    role: 'POST /login · GET /api/intersections · Publicador logs_queue',
    url: API_REST_URL,
    cx: 410,
    cy: 96,
  },
  {
    id: 'auth-service',
    title: 'Auth Service',
    container: 'auth-service',
    port: ':8005',
    kind: 'service',
    zone: 'SECURITY TIER',
    tech: 'FastAPI · JWT HS256',
    role: 'Validación de credenciales de Operador/Admin y firma JWT',
    url: AUTH_SERVICE_URL,
    cx: 790,
    cy: 96,
  },
  {
    id: 'auth-db',
    title: 'Auth Database',
    container: 'auth-db',
    port: ':5433',
    kind: 'database',
    zone: 'PERSISTENCE',
    tech: 'PostgreSQL 16 (auth_db)',
    role: 'Tabla users · Credenciales y roles del sistema',
    cx: 1110,
    cy: 96,
  },

  // Row 2: Edge Ingestion -> RabbitMQ -> CV Workers -> PostgreSQL Results
  {
    id: 'edge-processor',
    title: 'Edge Processor',
    container: 'edge-processor',
    port: ':8001',
    kind: 'service',
    zone: 'EDGE INGESTION',
    tech: 'FastAPI · Boto3 · Pika',
    role: 'Captura clips de cámaras de Montevideo, sube a S3 y encola evento',
    url: EDGE_PROCESSOR_URL,
    cx: 130,
    cy: 295,
  },
  {
    id: 'camera-queue',
    title: 'Camera Queue',
    container: 'camera-queue',
    port: ':5672',
    kind: 'broker',
    zone: 'MESSAGE BROKER #1',
    tech: 'RabbitMQ 3.13 (AMQP)',
    role: 'Cola durable camera_processing_queue · Desacopla ingesta y CV',
    cx: 410,
    cy: 295,
  },
  {
    id: 'cv-module',
    title: 'CV Module Workers',
    container: 'cv-module',
    port: ':8002',
    kind: 'service',
    zone: 'CV WORKER POOL (x3)',
    tech: 'FastAPI · YOLO/OpenCV',
    role: 'Consume camera_processing_queue, descarga clip S3 y cuenta vehículos',
    url: CV_MODULE_URL,
    cx: 790,
    cy: 295,
  },
  {
    id: 'results-db',
    title: 'Results Database',
    container: 'results-db',
    port: ':5434',
    kind: 'database',
    zone: 'PERSISTENCE',
    tech: 'PostgreSQL 16 (results_db)',
    role: 'Estado consolidado por intersección y serie temporal histórica',
    cx: 1110,
    cy: 295,
  },

  // Row 3: Object Storage / Visualization / Logs Broker / Monitoring Pipeline
  {
    id: 'clips-db',
    title: 'Clips Object Store',
    container: 'clips-db',
    port: ':9000',
    kind: 'object-store',
    zone: 'OBJECT STORAGE',
    tech: 'MinIO S3 (s3://clips)',
    role: 'Almacenamiento de fragmentos de video MP4 crudos',
    cx: 130,
    cy: 494,
  },
  {
    id: 'visualization-backend',
    title: 'Visualization Service',
    container: 'visualization-backend',
    port: ':8003',
    kind: 'service',
    zone: 'ANALYTICS TIER',
    tech: 'FastAPI · Psycopg2',
    role: 'Cálculo de saturación, velocidad media y detección de patrón',
    url: VISUALIZATION_BACKEND_URL,
    cx: 410,
    cy: 494,
  },
  {
    id: 'logs-queue',
    title: 'Logs Queue',
    container: 'logs-queue',
    port: ':5673',
    kind: 'broker',
    zone: 'MESSAGE BROKER #2',
    tech: 'RabbitMQ 3.13 (AMQP)',
    role: 'Cola durable logs_queue · Centraliza telemetría y auditoría',
    cx: 790,
    cy: 494,
  },
  {
    id: 'monitoring-pipeline',
    title: 'Monitoring Pipeline',
    container: 'monitoring-pipeline',
    port: ':8004',
    kind: 'service',
    zone: 'OBSERVABILITY',
    tech: 'FastAPI · Pika · Httpx',
    role: 'Consumidor de logs_queue y chequeo de salud de contenedores',
    url: MONITORING_PIPELINE_URL,
    cx: 1110,
    cy: 494,
  },
];

const DIAGRAM_LINKS: DiagramLinkSpec[] = [
  {
    id: 'frontend->api-rest',
    from: 'frontend',
    to: 'api-rest',
    protocol: 'HTTP / JSON',
    color: '#3B82F6',
  },
  {
    id: 'api-rest->auth-service',
    from: 'api-rest',
    to: 'auth-service',
    protocol: 'POST /login',
    color: '#A855F7',
  },
  {
    id: 'auth-service->auth-db',
    from: 'auth-service',
    to: 'auth-db',
    protocol: 'SQL :5432',
    color: '#A855F7',
  },
  {
    id: 'edge-processor->clips-db',
    from: 'edge-processor',
    to: 'clips-db',
    protocol: 'S3 PUT MP4',
    color: '#38BDF8',
  },
  {
    id: 'edge-processor->camera-queue',
    from: 'edge-processor',
    to: 'camera-queue',
    protocol: 'AMQP PUB :5672',
    color: '#F59E0B',
  },
  {
    id: 'camera-queue->cv-module',
    from: 'camera-queue',
    to: 'cv-module',
    protocol: 'AMQP CONSUME',
    color: '#10B981',
  },
  {
    id: 'cv-module->results-db',
    from: 'cv-module',
    to: 'results-db',
    protocol: 'SQL INSERT',
    color: '#10B981',
  },
  {
    id: 'results-db->visualization-backend',
    from: 'results-db',
    to: 'visualization-backend',
    protocol: 'SQL SELECT',
    color: '#3B82F6',
    curveOffset: [0, 55],
  },
  {
    id: 'visualization-backend->api-rest',
    from: 'visualization-backend',
    to: 'api-rest',
    protocol: 'HTTP :8003',
    color: '#3B82F6',
    curveOffset: [-48, 0],
  },
  {
    id: 'api-rest->logs-queue',
    from: 'api-rest',
    to: 'logs-queue',
    protocol: 'AMQP LOG',
    color: '#F59E0B',
    curveOffset: [20, 40],
  },
  {
    id: 'cv-module->logs-queue',
    from: 'cv-module',
    to: 'logs-queue',
    protocol: 'AMQP LOG',
    color: '#F59E0B',
  },
  {
    id: 'logs-queue->monitoring-pipeline',
    from: 'logs-queue',
    to: 'monitoring-pipeline',
    protocol: 'AMQP CONSUME :5673',
    color: '#38BDF8',
  },
];

const NODE_MAP: Record<NodeId, DiagramNodeSpec> = DIAGRAM_NODES.reduce((acc, n) => {
  acc[n.id] = n;
  return acc;
}, {} as Record<NodeId, DiagramNodeSpec>);

function buildLinkPath(link: DiagramLinkSpec): {
  d: string;
  p0: [number, number];
  p1: [number, number];
  p2: [number, number];
} {
  const src = NODE_MAP[link.from];
  const dst = NODE_MAP[link.to];
  const p0: [number, number] = [src.cx, src.cy];
  const p2: [number, number] = [dst.cx, dst.cy];
  const midX = (p0[0] + p2[0]) / 2 + (link.curveOffset?.[0] ?? 0);
  const midY = (p0[1] + p2[1]) / 2 + (link.curveOffset?.[1] ?? 0);
  const p1: [number, number] = [midX, midY];
  const d = `M ${p0[0]} ${p0[1]} Q ${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]}`;
  return { d, p0, p1, p2 };
}

function pointOnQuadBezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  t: number
): [number, number] {
  const u = 1 - t;
  const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
  const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
  return [x, y];
}

function formatJoacoTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

export const SystemBackendView: React.FC<SystemBackendViewProps> = ({
  isFaultTolerantDemoMode,
  onToggleFaultTolerance,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<NodeId>('camera-queue');
  const [packets, setPackets] = useState<InFlightPacket[]>([]);
  const [processingNodes, setProcessingNodes] = useState<Record<NodeId, string | null>>({} as Record<NodeId, string | null>);
  const [nowTick, setNowTick] = useState<number>(() => performance.now());

  const [cameraQueueReady, setCameraQueueReady] = useState<number>(3);
  const [logsQueueReady, setLogsQueueReady] = useState<number>(1);
  const [resultsDbCount, setResultsDbCount] = useState<number>(18420);
  const [clipsCount, setClipsCount] = useState<number>(1284);
  const [isSimPaused, setIsSimPaused] = useState<boolean>(false);

  const [logs, setLogs] = useState<DistributedLogEntry[]>(() => {
    const now = Date.now();
    return [
      {
        id: 'init-1',
        timestamp: formatJoacoTimestamp(new Date(now - 5200)),
        service: 'API-REST',
        level: 'INFO',
        queue: 'logs_queue',
        message: 'Login request received, sending to auth service (POST http://auth-service:8005)',
      },
      {
        id: 'init-2',
        timestamp: formatJoacoTimestamp(new Date(now - 4500)),
        service: 'AUTH-SERVICE',
        level: 'ACK',
        queue: 'logs_queue',
        message: 'Validated user="admin.central" against auth-db:5433 · Issued JWT HS256',
      },
      {
        id: 'init-3',
        timestamp: formatJoacoTimestamp(new Date(now - 3100)),
        service: 'EDGE-PROC',
        level: 'INFO',
        queue: 'camera_processing_queue',
        message: 'Uploaded s3://clips/CAM-MVD-101.mp4 -> Published frame task to camera_processing_queue',
      },
      {
        id: 'init-4',
        timestamp: formatJoacoTimestamp(new Date(now - 1800)),
        service: 'CV-MODULE',
        level: 'ACK',
        queue: 'camera_processing_queue',
        message: 'Worker cv-worker-02 ACK CAM-MVD-101 (98 veh · 12 km/h) -> INSERT INTO results-db:5434',
      },
    ];
  });
  const [logFilter, setLogFilter] = useState<LogSource>('ALL');

  const packetSeqRef = useRef<number>(1);
  const timersRef = useRef<number[]>([]);

  const clearScheduledTimers = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  };

  useEffect(() => {
    return () => clearScheduledTimers();
  }, []);

  // Smooth 30fps animation loop for in-flight message packets
  useEffect(() => {
    let rafId: number;
    const step = (ts: number) => {
      setNowTick(ts);
      setPackets((prev) =>
        prev.filter((pkt) => ts - pkt.startedAt < pkt.durationMs)
      );
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const pulseNodeProcessing = useCallback((nodeId: NodeId, statusLabel: string, durationMs = 700) => {
    setProcessingNodes((prev) => ({ ...prev, [nodeId]: statusLabel }));
    const t = window.setTimeout(() => {
      setProcessingNodes((prev) => ({ ...prev, [nodeId]: null }));
    }, durationMs);
    timersRef.current.push(t);
  }, []);

  const spawnPacket = useCallback(
    (
      linkId: string,
      label: string,
      durationMs = 820,
      onArrive?: () => void
    ) => {
      const link = DIAGRAM_LINKS.find((l) => l.id === linkId);
      if (!link) return;
      const id = `pkt-${packetSeqRef.current++}`;
      const startedAt = performance.now();

      setPackets((prev) => [
        ...prev.slice(-18),
        {
          id,
          linkId: link.id,
          from: link.from,
          to: link.to,
          label,
          color: link.color,
          startedAt,
          durationMs,
        },
      ]);

      if (onArrive) {
        const t = window.setTimeout(onArrive, durationMs);
        timersRef.current.push(t);
      }
    },
    []
  );

  const appendLog = useCallback(
    (
      service: Exclude<LogSource, 'ALL'>,
      level: 'INFO' | 'WARN' | 'ACK',
      queue: 'logs_queue' | 'camera_processing_queue',
      message: string
    ) => {
      const entry: DistributedLogEntry = {
        id: `log-${packetSeqRef.current++}`,
        timestamp: formatJoacoTimestamp(new Date()),
        service,
        level,
        queue,
        message,
      };
      setLogs((prev) => [entry, ...prev.slice(0, 34)]);
    },
    []
  );

  // Flow 1: Camera Frame Ingestion -> S3 + RabbitMQ -> CV Worker -> Results DB -> Logs Queue
  const triggerCameraPipelineFlow = useCallback(() => {
    const cams = ['CAM-MVD-101', 'CAM-MVD-102', 'CAM-MVD-103', 'CAM-MVD-104', 'CAM-MVD-107'];
    const cam = cams[Math.floor(Math.random() * cams.length)];

    // Step 1: Edge processor captures clip
    pulseNodeProcessing('edge-processor', `CAPTURANDO ${cam}`, 650);

    // Step 1a: Edge uploads MP4 to MinIO S3
    spawnPacket('edge-processor->clips-db', `PUT ${cam}.mp4`, 750, () => {
      pulseNodeProcessing('clips-db', 'S3 WRITE OK', 550);
      setClipsCount((c) => c + 1);
    });

    // Step 1b: Edge publishes metadata event to camera-queue
    spawnPacket('edge-processor->camera-queue', `ENQUEUE ${cam}`, 820, () => {
      if (isFaultTolerantDemoMode) {
        pulseNodeProcessing('camera-queue', 'RETENIENDO MSG', 950);
        setCameraQueueReady((q) => q + 1);
        appendLog(
          'RABBITMQ',
          'WARN',
          'camera_processing_queue',
          `cv-module workers offline · Frame ${cam} buffered in durable queue camera_processing_queue`
        );
        return;
      }

      pulseNodeProcessing('camera-queue', 'ROUTING AMQP', 500);
      setCameraQueueReady((q) => Math.max(1, (q % 5) + 1));

      // Step 2: camera-queue dispatches to cv-module worker
      spawnPacket('camera-queue->cv-module', `FRAME ${cam}`, 820, () => {
        pulseNodeProcessing('cv-module', `YOLO INFERENCE · ${cam}`, 900);

        // Step 3a: cv-module writes vehicle count to results-db
        const tAfterInference = window.setTimeout(() => {
          const count = Math.floor(Math.random() * 75) + 28;
          spawnPacket('cv-module->results-db', `INSERT ${count} VEH`, 740, () => {
            pulseNodeProcessing('results-db', 'COMMIT SQL', 550);
            setResultsDbCount((r) => r + 1);
          });

          // Step 3b: cv-module pushes audit log to logs-queue
          spawnPacket('cv-module->logs-queue', `LOG ACK ${cam}`, 780, () => {
            pulseNodeProcessing('logs-queue', 'ENQUEUE LOG', 500);
            appendLog(
              'CV-MODULE',
              'ACK',
              'camera_processing_queue',
              `Processed ${cam} (${count} veh) -> committed to results-db:5434`
            );
            spawnPacket('logs-queue->monitoring-pipeline', 'METRIC BATCH', 700, () => {
              pulseNodeProcessing('monitoring-pipeline', 'INDEXED', 500);
            });
          });
        }, 420);
        timersRef.current.push(tAfterInference);
      });
    });
  }, [appendLog, isFaultTolerantDemoMode, pulseNodeProcessing, spawnPacket]);

  // Flow 2: Login / Auth JWT validation + Joaco's logs_queue push
  const triggerAuthFlow = useCallback(() => {
    pulseNodeProcessing('frontend', 'POST /login', 500);

    spawnPacket('frontend->api-rest', 'POST /login', 680, () => {
      pulseNodeProcessing('api-rest', 'AUTH PROXY', 650);

      // Joaco's rabbitMQpush to logs-queue
      spawnPacket('api-rest->logs-queue', 'LOG: Login req', 760, () => {
        pulseNodeProcessing('logs-queue', 'MSG QUEUED', 450);
        setLogsQueueReady((c) => (c % 3) + 1);
        appendLog(
          'API-REST',
          'INFO',
          'logs_queue',
          'Login request received, sending to auth service'
        );
        spawnPacket('logs-queue->monitoring-pipeline', 'CONSUME LOG', 680, () => {
          pulseNodeProcessing('monitoring-pipeline', 'HEARTBEAT OK', 500);
        });
      });

      // Forward credentials to auth-service
      spawnPacket('api-rest->auth-service', 'VERIFY CREDENTIALS', 740, () => {
        pulseNodeProcessing('auth-service', 'SIGNING JWT', 700);

        spawnPacket('auth-service->auth-db', 'SELECT user', 640, () => {
          pulseNodeProcessing('auth-db', 'ROW MATCH', 520);
          appendLog(
            'AUTH-SERVICE',
            'ACK',
            'logs_queue',
            'Login response received from auth service, sending to frontend (JWT HS256)'
          );
        });
      });
    });
  }, [appendLog, pulseNodeProcessing, spawnPacket]);

  // Flow 3: Dashboard Telemetry Query (Frontend -> BFF -> Visualization -> Results DB)
  const triggerTelemetryQueryFlow = useCallback(() => {
    pulseNodeProcessing('frontend', 'GET /intersections', 500);
    spawnPacket('frontend->api-rest', 'GET /intersections', 660, () => {
      pulseNodeProcessing('api-rest', 'BFF QUERY', 600);
      spawnPacket('visualization-backend->api-rest', '8 NODES JSON', 740, () => {
        pulseNodeProcessing('visualization-backend', 'AGGREGATING', 650);
      });
      spawnPacket('results-db->visualization-backend', 'TIME SERIES', 720, () => {
        pulseNodeProcessing('results-db', 'SELECT SNAPSHOT', 520);
      });
    });
  }, [pulseNodeProcessing, spawnPacket]);

  // Automatic background orchestration so the deployment diagram is always alive
  useEffect(() => {
    if (isSimPaused) return;
    const t0 = window.setTimeout(() => triggerCameraPipelineFlow(), 350);
    let step = 0;
    const interval = window.setInterval(() => {
      step += 1;
      if (step % 3 === 0) {
        triggerAuthFlow();
      } else if (step % 3 === 1) {
        triggerCameraPipelineFlow();
      } else {
        triggerCameraPipelineFlow();
        triggerTelemetryQueryFlow();
      }
    }, 2600);

    return () => {
      window.clearTimeout(t0);
      window.clearInterval(interval);
    };
  }, [isSimPaused, triggerAuthFlow, triggerCameraPipelineFlow, triggerTelemetryQueryFlow]);

  const linkGeometries = useMemo(
    () =>
      DIAGRAM_LINKS.map((link) => ({
        link,
        ...buildLinkPath(link),
      })),
    []
  );

  const selectedNode = NODE_MAP[selectedNodeId];
  const inboundLinks = DIAGRAM_LINKS.filter((l) => l.to === selectedNodeId);
  const outboundLinks = DIAGRAM_LINKS.filter((l) => l.from === selectedNodeId);

  const filteredLogs =
    logFilter === 'ALL' ? logs : logs.filter((entry) => entry.service === logFilter);

  const getNodeMetricBadge = (nodeId: NodeId): string => {
    switch (nodeId) {
      case 'frontend':
        return 'SPA · JWT ACTIVE';
      case 'api-rest':
        return 'BFF · 24 req/s';
      case 'auth-service':
        return 'HS256 · ONLINE';
      case 'auth-db':
        return '12 USERS · :5433';
      case 'edge-processor':
        return '8 CAMERAS · 8 fps';
      case 'camera-queue':
        return isFaultTolerantDemoMode
          ? `${cameraQueueReady} MSG RETAINED`
          : `${cameraQueueReady} READY · 8.4/s`;
      case 'cv-module':
        return isFaultTolerantDemoMode ? '0/3 WORKERS (PAUSED)' : '3/3 WORKERS · 42ms';
      case 'results-db':
        return `${resultsDbCount.toLocaleString()} ROWS`;
      case 'clips-db':
        return `${clipsCount} MP4 CLIPS`;
      case 'visualization-backend':
        return 'SERIES · 12 req/s';
      case 'logs-queue':
        return `${logsQueueReady} READY · 14.5/s`;
      case 'monitoring-pipeline':
        return '11/11 NODES WATCHED';
    }
  };

  return (
    <main className="sys-workspace" aria-label="Diagrama de despliegue e interacción de componentes">
      {/* Top operational subheader */}
      <div className="sys-subheader">
        <div className="sys-subheader-left">
          <span className="sys-admin-badge">ADMIN ONLY · DEPLOYMENT & MESSAGE FLOW</span>
          <h1 className="sys-title">Diagrama de Componentes y Flujo de Mensajes en Vivo</h1>
          <span className="sys-subtitle">
            Red <code>distributed_net</code> · 12 nodos · Paquetes AMQP / HTTP / SQL / S3 en tiempo real
          </span>
        </div>

        <div className="sys-subheader-right">
          <button
            type="button"
            className="sim-btn primary"
            onClick={triggerCameraPipelineFlow}
            id="btn-inject-frame"
            title="Disparar manualmente un lote de video desde Edge Processor hacia S3, RabbitMQ, CV Workers y PostgreSQL"
          >
            <Send size={13} strokeWidth={1.75} />
            <span>Inyectar Frame CV</span>
          </button>

          <button
            type="button"
            className="sim-btn"
            onClick={triggerAuthFlow}
            id="btn-inject-login"
            title="Disparar flujo POST /login -> Auth Service + Auth DB y log en RabbitMQ logs_queue"
          >
            <Zap size={13} strokeWidth={1.75} />
            <span>Simular POST /login</span>
          </button>

          <button
            type="button"
            className={`sim-btn ${isFaultTolerantDemoMode ? 'active danger' : ''}`}
            onClick={onToggleFaultTolerance}
            id="btn-sys-fault-toggle"
            title="Pausar workers cv-module para observar cómo los paquetes quedan retenidos en camera-queue sin pérdida"
          >
            <ShieldAlert size={14} strokeWidth={1.75} />
            <span>
              {isFaultTolerantDemoMode ? 'Restaurar Workers CV' : 'Caída Workers CV'}
            </span>
          </button>

          <button
            type="button"
            className="sim-btn"
            onClick={() => setIsSimPaused((p) => !p)}
            id="btn-pause-flow"
          >
            {isSimPaused ? <Play size={13} strokeWidth={1.75} /> : <Pause size={13} strokeWidth={1.75} />}
            <span>{isSimPaused ? 'Reanudar Flujo' : 'Pausar'}</span>
          </button>
        </div>
      </div>

      <div className="sys-content">
        {/* MAIN COMPONENT & DEPLOYMENT GRAPH + SIDE INSPECTOR */}
        <section className="sys-diagram-shell" aria-label="Grafo interactivo de contenedores">
          <div className="sys-diagram-stage">
            <div className="sys-diagram-legend">
              <span className="legend-pill">
                <i style={{ background: '#F59E0B' }} /> AMQP RabbitMQ
              </span>
              <span className="legend-pill">
                <i style={{ background: '#10B981' }} /> Inferencia CV & SQL Insert
              </span>
              <span className="legend-pill">
                <i style={{ background: '#3B82F6' }} /> HTTP / BFF / Consultas
              </span>
              <span className="legend-pill">
                <i style={{ background: '#A855F7' }} /> Auth & JWT
              </span>
              <span className="legend-pill">
                <i style={{ background: '#38BDF8' }} /> MinIO S3 & Telemetría
              </span>
            </div>

            <svg
              className="sys-diagram-svg"
              viewBox="0 0 1260 590"
              preserveAspectRatio="xMidYMid meet"
              data-testid="deployment-diagram-svg"
            >
              <defs>
                <pattern id="sys-grid" width="28" height="28" patternUnits="userSpaceOnUse">
                  <path
                    d="M 28 0 L 0 0 0 28"
                    fill="none"
                    stroke="rgba(255,255,255,0.03)"
                    strokeWidth="1"
                  />
                </pattern>
                <filter id="pkt-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3.2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Subtle engineering grid background */}
              <rect width="1260" height="590" fill="url(#sys-grid)" />

              {/* Deployment Tier Swimlanes */}
              <g className="sys-swimlanes">
                <rect
                  x="22"
                  y="24"
                  width="1216"
                  height="146"
                  rx="8"
                  fill="rgba(255,255,255,0.01)"
                  stroke="rgba(255,255,255,0.05)"
                  strokeDasharray="4 6"
                />
                <text x="36" y="42" className="sys-lane-label">
                  PLANO DE ACCESO, BFF GATEWAY & AUTENTICACIÓN JWT
                </text>

                <rect
                  x="22"
                  y="214"
                  width="1216"
                  height="160"
                  rx="8"
                  fill="rgba(255,255,255,0.012)"
                  stroke="rgba(255,255,255,0.05)"
                  strokeDasharray="4 6"
                />
                <text x="36" y="232" className="sys-lane-label">
                  PLANO DE PROCESAMIENTO ASÍNCRONO DE VIDEO (EDGE → RABBITMQ → CV WORKERS → POSTGRESQL)
                </text>

                <rect
                  x="22"
                  y="414"
                  width="1216"
                  height="152"
                  rx="8"
                  fill="rgba(255,255,255,0.01)"
                  stroke="rgba(255,255,255,0.05)"
                  strokeDasharray="4 6"
                />
                <text x="36" y="432" className="sys-lane-label">
                  PLANO DE OBJECT STORAGE (MINIO S3), ANALÍTICA Y OBSERVABILIDAD DISTRIBUIDA
                </text>
              </g>

              {/* Directed Connector Paths + Protocol Badges */}
              {linkGeometries.map(({ link, d, p0, p1, p2 }) => {
                const isBlockedCvLink =
                  isFaultTolerantDemoMode &&
                  (link.id === 'camera-queue->cv-module' ||
                    link.id === 'cv-module->results-db' ||
                    link.id === 'cv-module->logs-queue');

                const isHighlighted =
                  link.from === selectedNodeId || link.to === selectedNodeId;

                const [labelX, labelY] = pointOnQuadBezier(p0, p1, p2, 0.5);

                return (
                  <g key={link.id} className="sys-link-group">
                    {/* Base subtle halo when selected */}
                    {isHighlighted && (
                      <path
                        d={d}
                        fill="none"
                        stroke={link.color}
                        strokeWidth="5"
                        strokeOpacity="0.16"
                      />
                    )}

                    {/* Main wire */}
                    <path
                      d={d}
                      fill="none"
                      stroke={isBlockedCvLink ? '#EF4444' : isHighlighted ? link.color : 'rgba(255,255,255,0.16)'}
                      strokeWidth={isHighlighted ? 2 : 1.4}
                      strokeDasharray={isBlockedCvLink ? '4 6' : undefined}
                      strokeOpacity={isBlockedCvLink ? 0.5 : 0.9}
                    />

                    {/* Protocol label pill on wire */}
                    <g transform={`translate(${labelX}, ${labelY})`}>
                      <rect
                        x="-48"
                        y="-9"
                        width="96"
                        height="18"
                        rx="4"
                        fill="#09090B"
                        stroke={isBlockedCvLink ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.1)'}
                      />
                      <text
                        x="0"
                        y="3.5"
                        textAnchor="middle"
                        className="sys-wire-label"
                        fill={isBlockedCvLink ? '#EF4444' : '#A1A1AA'}
                      >
                        {isBlockedCvLink ? 'PAUSED' : link.protocol}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* Component / Container Nodes */}
              {DIAGRAM_NODES.map((node) => {
                const isSelected = node.id === selectedNodeId;
                const isCvDegraded = isFaultTolerantDemoMode && node.id === 'cv-module';
                const isQueueRetaining = isFaultTolerantDemoMode && node.id === 'camera-queue';
                const activeProcessLabel = processingNodes[node.id];
                const isProcessing = Boolean(activeProcessLabel) && !isCvDegraded;

                const width = 212;
                const height = 88;
                const x = node.cx - width / 2;
                const y = node.cy - height / 2;

                const borderColor = isCvDegraded
                  ? '#EF4444'
                  : isQueueRetaining
                  ? '#F59E0B'
                  : isSelected
                  ? '#3B82F6'
                  : isProcessing
                  ? '#10B981'
                  : 'rgba(255,255,255,0.13)';

                const statusColor = isCvDegraded
                  ? '#EF4444'
                  : isQueueRetaining
                  ? '#F59E0B'
                  : '#10B981';

                return (
                  <g
                    key={node.id}
                    transform={`translate(${x}, ${y})`}
                    className={`sys-node-group ${isSelected ? 'selected' : ''} ${
                      isProcessing ? 'processing' : ''
                    }`}
                    onClick={() => setSelectedNodeId(node.id)}
                    data-testid={`diagram-node-${node.id}`}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Outer active processing halo */}
                    {(isProcessing || isSelected) && (
                      <rect
                        x="-3"
                        y="-3"
                        width={width + 6}
                        height={height + 6}
                        rx="9"
                        fill="none"
                        stroke={isSelected ? '#3B82F6' : '#10B981'}
                        strokeOpacity={isProcessing ? '0.45' : '0.3'}
                        strokeWidth="2"
                      />
                    )}

                    {/* Node Card Body */}
                    <rect
                      width={width}
                      height={height}
                      rx="7"
                      fill="#111114"
                      stroke={borderColor}
                      strokeWidth={isSelected || isProcessing ? '1.6' : '1'}
                    />

                    {/* Top Header Strip */}
                    <rect
                      x="1"
                      y="1"
                      width={width - 2}
                      height="24"
                      rx="6"
                      fill="rgba(255,255,255,0.03)"
                    />

                    {/* Status Dot + Container Name + Port */}
                    <circle cx="14" cy="13" r="3.8" fill={statusColor} />
                    {isProcessing && (
                      <circle
                        cx="14"
                        cy="13"
                        r="7"
                        fill="none"
                        stroke="#10B981"
                        strokeWidth="1.2"
                        className="sys-node-pulse-ring"
                      />
                    )}
                    <text x="24" y="16.5" className="sys-node-container">
                      {node.container}
                    </text>
                    <text x={width - 10} y="16.5" textAnchor="end" className="sys-node-port">
                      {node.port}
                    </text>

                    {/* Title & Stack */}
                    <text x="12" y="44" className="sys-node-title">
                      {node.title}
                    </text>
                    <text x="12" y="59" className="sys-node-tech">
                      {node.tech}
                    </text>

                    {/* Bottom Telemetry / Processing Pill */}
                    <rect
                      x="10"
                      y="66"
                      width={width - 20}
                      height="16"
                      rx="3"
                      fill={
                        isCvDegraded
                          ? 'rgba(239,68,68,0.15)'
                          : isProcessing
                          ? 'rgba(16,185,129,0.16)'
                          : 'rgba(255,255,255,0.04)'
                      }
                    />
                    <text
                      x="16"
                      y="77"
                      className="sys-node-metric"
                      fill={
                        isCvDegraded
                          ? '#EF4444'
                          : isProcessing
                          ? '#34D399'
                          : '#A1A1AA'
                      }
                    >
                      {activeProcessLabel
                        ? `● ${activeProcessLabel}`
                        : getNodeMetricBadge(node.id)}
                    </text>
                  </g>
                );
              })}

              {/* Animated In-Flight Message Packets (rendered on top of nodes & wires) */}
              {packets.map((pkt) => {
                const geom = linkGeometries.find((g) => g.link.id === pkt.linkId);
                if (!geom) return null;
                const progress = Math.min(
                  1,
                  Math.max(0, (nowTick - pkt.startedAt) / pkt.durationMs)
                );
                // Travel along the visible wire segment between card edges (t = 0.24 -> 0.76)
                const wireT = 0.24 + progress * 0.52;
                const [x, y] = pointOnQuadBezier(geom.p0, geom.p1, geom.p2, wireT);

                return (
                  <g
                    key={pkt.id}
                    transform={`translate(${x}, ${y})`}
                    className="sys-packet"
                    style={{ pointerEvents: 'none' }}
                  >
                    <circle
                      r="5.5"
                      fill={pkt.color}
                      filter="url(#pkt-glow)"
                    />
                    <circle r="2.2" fill="#FAFAFA" />
                    <g transform="translate(0, -14)">
                      <rect
                        x="-48"
                        y="-10"
                        width="96"
                        height="16"
                        rx="3"
                        fill="rgba(9, 9, 11, 0.95)"
                        stroke={pkt.color}
                        strokeWidth="1"
                      />
                      <text
                        x="0"
                        y="1"
                        textAnchor="middle"
                        className="sys-packet-label"
                      >
                        {pkt.label}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Right Side Component Inspector */}
          <aside className="sys-node-inspector" aria-label="Inspector del contenedor seleccionado">
            <div className="sys-inspector-head">
              <span className="label-caps">CONTENEDOR SELECCIONADO</span>
              <span className="sys-port-tag">{selectedNode.port}</span>
            </div>

            <div className="sys-inspector-title-wrap">
              <div className="sys-inspector-zone">{selectedNode.zone}</div>
              <h2 className="sys-inspector-title">{selectedNode.title}</h2>
              <code className="sys-inspector-container">
                docker://{selectedNode.container}
                {selectedNode.port}
              </code>
            </div>

            <p className="sys-inspector-desc">{selectedNode.role}</p>

            <div className="sys-inspector-kv">
              <div>
                <span className="label-caps">Stack</span>
                <strong>{selectedNode.tech}</strong>
              </div>
              <div>
                <span className="label-caps">Estado Actual</span>
                <strong
                  className={
                    isFaultTolerantDemoMode && selectedNode.id === 'cv-module'
                      ? 'c-critical'
                      : 'c-fluid'
                  }
                >
                  {isFaultTolerantDemoMode && selectedNode.id === 'cv-module'
                    ? 'PAUSADO (DEMO FALLO)'
                    : processingNodes[selectedNode.id] || 'ONLINE · IDLE'}
                </strong>
              </div>
              <div>
                <span className="label-caps">Métrica Clave</span>
                <strong>{getNodeMetricBadge(selectedNode.id)}</strong>
              </div>
            </div>

            <div className="sys-inspector-connections">
              <div className="label-caps">CONEXIONES ENTRANTES ({inboundLinks.length})</div>
              {inboundLinks.length === 0 ? (
                <div className="sys-conn-empty">Origen de flujo (sin entradas)</div>
              ) : (
                inboundLinks.map((l) => (
                  <div key={l.id} className="sys-conn-row">
                    <code>{l.from}</code>
                    <span className="sys-conn-proto">{l.protocol}</span>
                  </div>
                ))
              )}

              <div className="label-caps" style={{ marginTop: 10 }}>
                CONEXIONES SALIENTES ({outboundLinks.length})
              </div>
              {outboundLinks.length === 0 ? (
                <div className="sys-conn-empty">Nodo sumidero / almacenamiento</div>
              ) : (
                outboundLinks.map((l) => (
                  <div key={l.id} className="sys-conn-row">
                    <code>→ {l.to}</code>
                    <span className="sys-conn-proto">{l.protocol}</span>
                  </div>
                ))
              )}
            </div>
          </aside>
        </section>

        {/* BOTTOM: LIVE DISTRIBUTED LOG STREAM (logs_queue :5673) */}
        <section className="sys-section sys-logs-section" aria-label="Stream de logs distribuidos">
          <div className="sys-section-head">
            <div className="sys-section-title">
              <Terminal size={15} strokeWidth={1.75} />
              <span>Trazabilidad de Eventos en Tránsito (RabbitMQ · logs_queue :5673 & camera_processing_queue :5672)</span>
            </div>

            <div className="sys-log-controls">
              <div className="segmented small" role="tablist" aria-label="Filtrar logs por servicio">
                {(
                  ['ALL', 'API-REST', 'AUTH-SERVICE', 'EDGE-PROC', 'CV-MODULE', 'RABBITMQ'] as LogSource[]
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
                SIN EVENTOS PARA EL FILTRO SELECCIONADO ({logFilter})
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
