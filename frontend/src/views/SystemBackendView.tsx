import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Gauge,
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
import { fetchSystemHealthFromBff } from '../services/bffApi';

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
  /** SVG center coordinates on a 1320 x 610 planar canvas */
  cx: number;
  cy: number;
}

interface DiagramLinkSpec {
  id: string;
  from: NodeId;
  to: NodeId;
  protocol: string;
  color: string;
  /** Exact edge-to-edge points [x, y] so no wire ever crosses a node or another wire */
  points: [number, number][];
  /** Explicit [x, y] position for the protocol label offset cleanly from the wire */
  labelPos: [number, number];
}

interface InFlightPacket {
  id: string;
  linkId: string;
  from: NodeId;
  to: NodeId;
  label: string;
  color: string;
  /** Progress from 0 to 1 along the link path */
  progress: number;
  /** Base duration in ms at 1x speed */
  baseDurationMs: number;
}

interface DistributedLogEntry {
  id: string;
  timestamp: string;
  service: Exclude<LogSource, 'ALL'>;
  level: 'INFO' | 'WARN' | 'ACK';
  queue: 'logs_queue' | 'camera_processing_queue';
  message: string;
}

const CARD_W = 204;
const CARD_H = 84;

/**
 * Planar 12-Node Topology (Zero edge-edge crossings, zero node-edge overlaps):
 * - Top Row (y=92):      [auth-db] <--- [auth-service] <--- [api-rest] <---> [frontend]
 * - Middle Row (y=295):  [edge-processor] ---> [camera-queue] ---> [cv-module] ---> [results-db] ---> [visualization-backend]
 * - Bottom Row (y=498):  [clips-db]                                [logs-queue] ---> [monitoring-pipeline]
 */
const DIAGRAM_NODES: DiagramNodeSpec[] = [
  // ROW 1 (y = 92): Security, BFF Gateway & Client Tier
  {
    id: 'auth-db',
    title: 'Auth Database',
    container: 'auth-db',
    port: ':5433',
    kind: 'database',
    zone: 'SECURITY PERSISTENCE',
    tech: 'PostgreSQL 16 (auth_db)',
    role: 'Tabla users · Credenciales y roles de Operador y Administrador',
    cx: 135,
    cy: 92,
  },
  {
    id: 'auth-service',
    title: 'Auth Service',
    container: 'auth-service',
    port: ':8005',
    kind: 'service',
    zone: 'SECURITY TIER',
    tech: 'FastAPI · JWT HS256',
    role: 'Valida credenciales contra auth-db y emite tokens JWT firmados',
    url: AUTH_SERVICE_URL,
    cx: 395,
    cy: 92,
  },
  {
    id: 'api-rest',
    title: 'API REST (BFF)',
    container: 'api-rest',
    port: ':8000',
    kind: 'service',
    zone: 'GATEWAY / BFF',
    tech: 'FastAPI · Pika · Requests',
    role: 'POST /login · GET /api/intersections · Publicador en logs_queue',
    url: API_REST_URL,
    cx: 660,
    cy: 92,
  },
  {
    id: 'frontend',
    title: 'React SPA Console',
    container: 'frontend',
    port: ':3000',
    kind: 'client',
    zone: 'CLIENT TIER',
    tech: 'React 18 · Vite · Leaflet',
    role: 'Consola web de supervisión urbana y telemetría de backend',
    cx: 1185,
    cy: 92,
  },

  // ROW 2 (y = 295): Edge Ingestion -> RabbitMQ -> CV Workers -> Results DB -> Visualization
  {
    id: 'edge-processor',
    title: 'Edge Processor',
    container: 'edge-processor',
    port: ':8001',
    kind: 'service',
    zone: 'EDGE INGESTION',
    tech: 'FastAPI · Boto3 · Pika',
    role: 'Captura clips de cámaras de Montevideo, sube MP4 a S3 y encola evento',
    url: EDGE_PROCESSOR_URL,
    cx: 135,
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
    role: 'Cola durable camera_processing_queue · Desacopla ingesta y workers CV',
    cx: 395,
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
    role: 'Consume camera_processing_queue, procesa video y persiste conteo vehicular',
    url: CV_MODULE_URL,
    cx: 660,
    cy: 295,
  },
  {
    id: 'results-db',
    title: 'Results Database',
    container: 'results-db',
    port: ':5434',
    kind: 'database',
    zone: 'TELEMETRY PERSISTENCE',
    tech: 'PostgreSQL 16 (results_db)',
    role: 'Estado consolidado por intersección y serie temporal histórica',
    cx: 925,
    cy: 295,
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
    cx: 1185,
    cy: 295,
  },

  // ROW 3 (y = 498): Object Storage & Distributed Logging / Monitoring
  {
    id: 'clips-db',
    title: 'Clips Object Store',
    container: 'clips-db',
    port: ':9000',
    kind: 'object-store',
    zone: 'OBJECT STORAGE',
    tech: 'MinIO S3 (s3://clips)',
    role: 'Almacenamiento de fragmentos de video MP4 crudos',
    cx: 135,
    cy: 498,
  },
  {
    id: 'logs-queue',
    title: 'Logs Queue',
    container: 'logs-queue',
    port: ':5673',
    kind: 'broker',
    zone: 'MESSAGE BROKER #2',
    tech: 'RabbitMQ 3.13 (AMQP)',
    role: 'Cola durable logs_queue · Centraliza eventos y auditoría del sistema',
    cx: 660,
    cy: 498,
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
    cx: 925,
    cy: 498,
  },
];

/**
 * Planar Links: Every wire starts and ends at the exact border of its cards
 * and routes through open corridors so ZERO wires cross each other or any card.
 */
const DIAGRAM_LINKS: DiagramLinkSpec[] = [
  // Row 1 horizontal links
  {
    id: 'frontend->api-rest',
    from: 'frontend',
    to: 'api-rest',
    protocol: 'HTTP / JSON',
    color: '#3B82F6',
    points: [
      [1083, 92],
      [762, 92],
    ],
    labelPos: [922, 75],
  },
  {
    id: 'api-rest->auth-service',
    from: 'api-rest',
    to: 'auth-service',
    protocol: 'POST /login',
    color: '#A855F7',
    points: [
      [558, 92],
      [497, 92],
    ],
    labelPos: [527, 75],
  },
  {
    id: 'auth-service->auth-db',
    from: 'auth-service',
    to: 'auth-db',
    protocol: 'SQL :5432',
    color: '#A855F7',
    points: [
      [293, 92],
      [237, 92],
    ],
    labelPos: [265, 75],
  },

  // Row 2 horizontal pipeline links
  {
    id: 'edge-processor->camera-queue',
    from: 'edge-processor',
    to: 'camera-queue',
    protocol: 'AMQP PUB :5672',
    color: '#F59E0B',
    points: [
      [237, 295],
      [293, 295],
    ],
    labelPos: [265, 278],
  },
  {
    id: 'camera-queue->cv-module',
    from: 'camera-queue',
    to: 'cv-module',
    protocol: 'AMQP CONSUME',
    color: '#10B981',
    points: [
      [497, 295],
      [558, 295],
    ],
    labelPos: [527, 278],
  },
  {
    id: 'cv-module->results-db',
    from: 'cv-module',
    to: 'results-db',
    protocol: 'SQL INSERT',
    color: '#10B981',
    points: [
      [762, 295],
      [823, 295],
    ],
    labelPos: [792, 278],
  },
  {
    id: 'results-db->visualization-backend',
    from: 'results-db',
    to: 'visualization-backend',
    protocol: 'SQL SELECT',
    color: '#3B82F6',
    points: [
      [1027, 295],
      [1083, 295],
    ],
    labelPos: [1055, 278],
  },

  // Clean vertical / orthogonal links between rows (zero crossings)
  {
    id: 'edge-processor->clips-db',
    from: 'edge-processor',
    to: 'clips-db',
    protocol: 'S3 PUT MP4',
    color: '#38BDF8',
    points: [
      [135, 337],
      [135, 456],
    ],
    labelPos: [182, 396],
  },
  {
    id: 'cv-module->logs-queue',
    from: 'cv-module',
    to: 'logs-queue',
    protocol: 'AMQP LOG',
    color: '#F59E0B',
    points: [
      [660, 337],
      [660, 456],
    ],
    labelPos: [704, 396],
  },
  {
    id: 'logs-queue->monitoring-pipeline',
    from: 'logs-queue',
    to: 'monitoring-pipeline',
    protocol: 'AMQP CONSUME :5673',
    color: '#38BDF8',
    points: [
      [762, 498],
      [823, 498],
    ],
    labelPos: [792, 481],
  },
  {
    id: 'visualization-backend->api-rest',
    from: 'visualization-backend',
    to: 'api-rest',
    protocol: 'HTTP :8003',
    color: '#3B82F6',
    // Cleanly rises from top of visualization-backend into the open corridor at y=162 and enters api-rest bottom-right
    points: [
      [1185, 253],
      [1185, 162],
      [720, 162],
      [720, 134],
    ],
    labelPos: [955, 149],
  },
  {
    id: 'api-rest->logs-queue',
    from: 'api-rest',
    to: 'logs-queue',
    protocol: 'AMQP LOG :5673',
    color: '#F59E0B',
    // Routes cleanly down the open vertical corridor at x=527 (between col 2 and col 3) into the left side of logs-queue
    points: [
      [600, 134],
      [600, 168],
      [527, 168],
      [527, 498],
      [558, 498],
    ],
    labelPos: [478, 396],
  },
];

const NODE_MAP: Record<NodeId, DiagramNodeSpec> = DIAGRAM_NODES.reduce((acc, n) => {
  acc[n.id] = n;
  return acc;
}, {} as Record<NodeId, DiagramNodeSpec>);

function buildPolylineSvgPath(points: [number, number][]): string {
  return points
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt[0]} ${pt[1]}`)
    .join(' ');
}

function pointAlongPolyline(points: [number, number][], t: number): [number, number] {
  if (points.length === 0) return [0, 0];
  if (points.length === 1 || t <= 0) return points[0];
  if (t >= 1) return points[points.length - 1];

  const segLengths: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dy = points[i + 1][1] - points[i][1];
    const len = Math.hypot(dx, dy);
    segLengths.push(len);
    totalLen += len;
  }

  if (totalLen === 0) return points[0];
  const targetDist = t * totalLen;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (acc + segLen >= targetDist) {
      const localT = segLen === 0 ? 0 : (targetDist - acc) / segLen;
      const x = points[i][0] + (points[i + 1][0] - points[i][0]) * localT;
      const y = points[i][1] + (points[i + 1][1] - points[i][1]) * localT;
      return [x, y];
    }
    acc += segLen;
  }
  return points[points.length - 1];
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
  const [selectedNodeId, setSelectedNodeId] = useState<NodeId>('cv-module');
  const [packets, setPackets] = useState<InFlightPacket[]>([]);
  const [processingNodes, setProcessingNodes] = useState<Record<NodeId, string | null>>(
    {} as Record<NodeId, string | null>
  );

  // Slow-motion mode (~5% of normal speed so messages can be read calmly in transit)
  const [isSlowMo, setIsSlowMo] = useState<boolean>(false);
  const speedFactor = isSlowMo ? 0.05 : 1.0;
  const speedFactorRef = useRef<number>(speedFactor);
  speedFactorRef.current = speedFactor;

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
  const onArriveCallbacksRef = useRef<Record<string, () => void>>({});

  const clearScheduledTimers = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  };

  useEffect(() => {
    return () => clearScheduledTimers();
  }, []);

  // Poll real /api/system/health from api-rest (Admin-only)
  useEffect(() => {
    let mounted = true;
    const pollHealth = async () => {
      const services = await fetchSystemHealthFromBff();
      if (!mounted || !services) return;
      const summary = Object.entries(services)
        .map(([name, info]: [string, any]) => `${name}:${info?.status || 'unknown'}`)
        .join(' · ');
      appendLog(
        'api-rest',
        'INFO',
        `GET /api/system/health -> ${summary}`,
        'logs_queue'
      );
    };
    void pollHealth();
    const timer = window.setInterval(() => void pollHealth(), 10000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [appendLog]);

  // Delta-time animation loop so toggling 5% Slow-Mo immediately slows down packets mid-flight
  useEffect(() => {
    let rafId: number;
    let lastTs = performance.now();

    const step = (ts: number) => {
      const dt = Math.min(64, Math.max(0, ts - lastTs));
      lastTs = ts;

      if (!isSimPaused) {
        const currentSpeed = speedFactorRef.current;
        const completedIds: string[] = [];

        setPackets((prev) => {
          if (prev.length === 0) return prev;
          const next: InFlightPacket[] = [];
          for (const pkt of prev) {
            const nextProgress = pkt.progress + (dt * currentSpeed) / pkt.baseDurationMs;
            if (nextProgress >= 1) {
              completedIds.push(pkt.id);
            } else {
              next.push({ ...pkt, progress: nextProgress });
            }
          }
          return next;
        });

        if (completedIds.length > 0) {
          window.setTimeout(() => {
            completedIds.forEach((id) => {
              const cb = onArriveCallbacksRef.current[id];
              if (cb) {
                delete onArriveCallbacksRef.current[id];
                cb();
              }
            });
          }, 0);
        }
      }

      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [isSimPaused]);

  const pulseNodeProcessing = useCallback((nodeId: NodeId, statusLabel: string, baseDurationMs = 750) => {
    // Scale node processing indicator duration gently in slow-mo so the user can read it too
    const scaledDuration = speedFactorRef.current < 0.2 ? baseDurationMs * 4.5 : baseDurationMs;
    setProcessingNodes((prev) => ({ ...prev, [nodeId]: statusLabel }));
    const t = window.setTimeout(() => {
      setProcessingNodes((prev) => ({ ...prev, [nodeId]: null }));
    }, scaledDuration);
    timersRef.current.push(t);
  }, []);

  const spawnPacket = useCallback(
    (linkId: string, label: string, baseDurationMs = 900, onArrive?: () => void) => {
      const link = DIAGRAM_LINKS.find((l) => l.id === linkId);
      if (!link) return;
      const id = `pkt-${packetSeqRef.current++}`;

      if (onArrive) {
        onArriveCallbacksRef.current[id] = onArrive;
      }

      setPackets((prev) => [
        ...prev.slice(-18),
        {
          id,
          linkId: link.id,
          from: link.from,
          to: link.to,
          label,
          color: link.color,
          progress: 0,
          baseDurationMs,
        },
      ]);
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

  // Flow 1: Camera Frame Ingestion -> S3 + RabbitMQ -> CV Worker -> Results DB -> Visualization & Logs
  const triggerCameraPipelineFlow = useCallback(() => {
    const cams = ['CAM-MVD-101', 'CAM-MVD-102', 'CAM-MVD-103', 'CAM-MVD-104', 'CAM-MVD-107'];
    const cam = cams[Math.floor(Math.random() * cams.length)];

    pulseNodeProcessing('edge-processor', `CAPTURANDO ${cam}`, 700);

    spawnPacket('edge-processor->clips-db', `PUT ${cam}.mp4`, 880, () => {
      pulseNodeProcessing('clips-db', 'S3 WRITE OK', 600);
      setClipsCount((c) => c + 1);
    });

    spawnPacket('edge-processor->camera-queue', `ENQUEUE ${cam}`, 920, () => {
      if (isFaultTolerantDemoMode) {
        pulseNodeProcessing('camera-queue', 'RETENIENDO MSG', 1000);
        setCameraQueueReady((q) => q + 1);
        appendLog(
          'RABBITMQ',
          'WARN',
          'camera_processing_queue',
          `cv-module workers offline · Frame ${cam} buffered in durable queue camera_processing_queue`
        );
        return;
      }

      pulseNodeProcessing('camera-queue', 'ROUTING AMQP', 600);
      setCameraQueueReady((q) => Math.max(1, (q % 5) + 1));

      spawnPacket('camera-queue->cv-module', `FRAME ${cam}`, 920, () => {
        pulseNodeProcessing('cv-module', `YOLO INFERENCE · ${cam}`, 950);

        const count = Math.floor(Math.random() * 75) + 28;
        spawnPacket('cv-module->results-db', `INSERT ${count} VEH`, 860, () => {
          pulseNodeProcessing('results-db', 'COMMIT SQL', 600);
          setResultsDbCount((r) => r + 1);

          spawnPacket('results-db->visualization-backend', `SERIES ${cam}`, 820, () => {
            pulseNodeProcessing('visualization-backend', 'AGGREGATING', 650);
          });
        });

        spawnPacket('cv-module->logs-queue', `LOG ACK ${cam}`, 880, () => {
          pulseNodeProcessing('logs-queue', 'ENQUEUE LOG', 550);
          appendLog(
            'CV-MODULE',
            'ACK',
            'camera_processing_queue',
            `Processed ${cam} (${count} veh) -> committed to results-db:5434`
          );
          spawnPacket('logs-queue->monitoring-pipeline', 'METRIC BATCH', 820, () => {
            pulseNodeProcessing('monitoring-pipeline', 'INDEXED', 550);
          });
        });
      });
    });
  }, [appendLog, isFaultTolerantDemoMode, pulseNodeProcessing, spawnPacket]);

  // Flow 2: Login / Auth JWT validation + Joaco's logs_queue push
  const triggerAuthFlow = useCallback(() => {
    pulseNodeProcessing('frontend', 'POST /login', 600);

    spawnPacket('frontend->api-rest', 'POST /login', 900, () => {
      pulseNodeProcessing('api-rest', 'AUTH PROXY', 700);

      spawnPacket('api-rest->logs-queue', 'LOG: Login req', 980, () => {
        pulseNodeProcessing('logs-queue', 'MSG QUEUED', 550);
        setLogsQueueReady((c) => (c % 3) + 1);
        appendLog(
          'API-REST',
          'INFO',
          'logs_queue',
          'Login request received, sending to auth service'
        );
        spawnPacket('logs-queue->monitoring-pipeline', 'CONSUME LOG', 820, () => {
          pulseNodeProcessing('monitoring-pipeline', 'HEARTBEAT OK', 550);
        });
      });

      spawnPacket('api-rest->auth-service', 'VERIFY USER', 860, () => {
        pulseNodeProcessing('auth-service', 'SIGNING JWT', 750);

        spawnPacket('auth-service->auth-db', 'SELECT user', 800, () => {
          pulseNodeProcessing('auth-db', 'ROW MATCH', 600);
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

  // Flow 3: BFF Telemetry response from Visualization Service
  const triggerTelemetryQueryFlow = useCallback(() => {
    pulseNodeProcessing('visualization-backend', 'SNAPSHOT READY', 600);
    spawnPacket('visualization-backend->api-rest', '8 NODES JSON', 960, () => {
      pulseNodeProcessing('api-rest', '200 OK · JSON', 600);
    });
  }, [pulseNodeProcessing, spawnPacket]);

  // Automatic background orchestration (interval scales with slow-mo so packets don't pile up)
  useEffect(() => {
    if (isSimPaused) return;
    const t0 = window.setTimeout(() => triggerCameraPipelineFlow(), 350);
    let step = 0;
    const intervalMs = isSlowMo ? 14000 : 2700;
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
    }, intervalMs);

    return () => {
      window.clearTimeout(t0);
      window.clearInterval(interval);
    };
  }, [isSimPaused, isSlowMo, triggerAuthFlow, triggerCameraPipelineFlow, triggerTelemetryQueryFlow]);

  const linkGeometries = useMemo(
    () =>
      DIAGRAM_LINKS.map((link) => ({
        link,
        d: buildPolylineSvgPath(link.points),
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
            Topología planar sin cruces · Red <code>distributed_net</code> · Velocidad{' '}
            <code>{isSlowMo ? '0.05x (5% Lento)' : '1.0x (Normal)'}</code>
          </span>
        </div>

        <div className="sys-subheader-right">
          <button
            type="button"
            className={`sim-btn ${isSlowMo ? 'active slowmo-active' : ''}`}
            onClick={() => setIsSlowMo((s) => !s)}
            id="btn-slow-mo"
            aria-pressed={isSlowMo}
            title="Modo Cámara Lenta (5% de velocidad normal) para inspeccionar y leer cada paquete en tránsito"
          >
            <Gauge size={14} strokeWidth={1.75} />
            <span>{isSlowMo ? 'Modo Lento 5% · ON' : 'Modo Lento (5%)'}</span>
          </button>

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
            <span>{isSimPaused ? 'Reanudar' : 'Pausar'}</span>
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
              {isSlowMo && (
                <span className="legend-slow-badge">
                  ● CÁMARA LENTA ACTIVA (5% VELOCIDAD) — LECTURA DETALLADA DE PAQUETES
                </span>
              )}
            </div>

            <svg
              className="sys-diagram-svg"
              viewBox="0 0 1320 600"
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
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <marker
                  id="arrow-muted"
                  viewBox="0 0 10 10"
                  refX="7"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="rgba(255,255,255,0.32)" />
                </marker>
              </defs>

              {/* Subtle engineering grid background */}
              <rect width="1320" height="600" fill="url(#sys-grid)" />

              {/* Deployment Tier Swimlanes */}
              <g className="sys-swimlanes">
                <rect
                  x="18"
                  y="20"
                  width="1284"
                  height="136"
                  rx="8"
                  fill="rgba(255,255,255,0.01)"
                  stroke="rgba(255,255,255,0.05)"
                  strokeDasharray="4 6"
                />
                <text x="32" y="38" className="sys-lane-label">
                  PLANO 01 · SEGURIDAD (AUTH-DB / AUTH-SERVICE), GATEWAY BFF & CLIENTE WEB
                </text>

                <rect
                  x="18"
                  y="222"
                  width="1284"
                  height="146"
                  rx="8"
                  fill="rgba(255,255,255,0.012)"
                  stroke="rgba(255,255,255,0.05)"
                  strokeDasharray="4 6"
                />
                <text x="32" y="240" className="sys-lane-label">
                  PLANO 02 · PIPELINE LINEAL DE VISIÓN ARTIFICIAL (EDGE → RABBITMQ #1 → CV WORKERS → RESULTS-DB → VISUALIZATION)
                </text>

                <rect
                  x="18"
                  y="426"
                  width="1284"
                  height="146"
                  rx="8"
                  fill="rgba(255,255,255,0.01)"
                  stroke="rgba(255,255,255,0.05)"
                  strokeDasharray="4 6"
                />
                <text x="32" y="444" className="sys-lane-label">
                  PLANO 03 · ALMACENAMIENTO S3 (MINIO) & OBSERVABILIDAD DISTRIBUIDA (RABBITMQ #2 → MONITORING PIPELINE)
                </text>
              </g>

              {/* Directed Planar Connector Paths + Offset Protocol Labels */}
              {linkGeometries.map(({ link, d }) => {
                const isBlockedCvLink =
                  isFaultTolerantDemoMode &&
                  (link.id === 'camera-queue->cv-module' ||
                    link.id === 'cv-module->results-db' ||
                    link.id === 'cv-module->logs-queue');

                const isHighlighted =
                  link.from === selectedNodeId || link.to === selectedNodeId;

                const [lx, ly] = link.labelPos;
                const startPt = link.points[0];
                const endPt = link.points[link.points.length - 1];

                return (
                  <g
                    key={link.id}
                    className={`sys-link-group ${isHighlighted ? 'is-highlighted' : ''}`}
                    data-testid={`diagram-link-${link.id}`}
                  >
                    {/* Outer glowing aura when a connected node is selected */}
                    {isHighlighted && (
                      <path
                        d={d}
                        fill="none"
                        stroke={isBlockedCvLink ? '#EF4444' : link.color}
                        strokeWidth="8"
                        strokeOpacity="0.24"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}

                    {/* Main continuous unobstructed wire */}
                    <path
                      d={d}
                      fill="none"
                      stroke={
                        isBlockedCvLink
                          ? '#EF4444'
                          : isHighlighted
                          ? link.color
                          : 'rgba(255,255,255,0.22)'
                      }
                      strokeWidth={isHighlighted ? 2.8 : 1.5}
                      strokeDasharray={isBlockedCvLink ? '4 6' : undefined}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      markerEnd="url(#arrow-muted)"
                    />

                    {/* Animated marching ants overlay on highlighted wires */}
                    {isHighlighted && !isBlockedCvLink && (
                      <path
                        d={d}
                        fill="none"
                        stroke="#FAFAFA"
                        strokeWidth="1.5"
                        strokeDasharray="3 9"
                        strokeOpacity="0.85"
                        className="sys-wire-highlight-flow"
                      />
                    )}

                    {/* Port connection terminals at both ends of the wire */}
                    <circle
                      cx={startPt[0]}
                      cy={startPt[1]}
                      r={isHighlighted ? 3.5 : 2.2}
                      fill={isHighlighted ? link.color : 'rgba(255,255,255,0.35)'}
                    />
                    <circle
                      cx={endPt[0]}
                      cy={endPt[1]}
                      r={isHighlighted ? 3.5 : 2.2}
                      fill={isHighlighted ? link.color : 'rgba(255,255,255,0.35)'}
                    />

                    {/* Offset translucent protocol label (positioned alongside the wire so the wire stays 100% visible) */}
                    <g transform={`translate(${lx}, ${ly})`}>
                      <text
                        x="0"
                        y="0"
                        textAnchor="middle"
                        className="sys-wire-label"
                        fill={
                          isBlockedCvLink
                            ? '#EF4444'
                            : isHighlighted
                            ? '#FAFAFA'
                            : 'rgba(161, 161, 170, 0.78)'
                        }
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

                const x = node.cx - CARD_W / 2;
                const y = node.cy - CARD_H / 2;

                const borderColor = isCvDegraded
                  ? '#EF4444'
                  : isQueueRetaining
                  ? '#F59E0B'
                  : isSelected
                  ? '#3B82F6'
                  : isProcessing
                  ? '#10B981'
                  : 'rgba(255,255,255,0.14)';

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
                    {/* Outer active processing / selection halo */}
                    {(isProcessing || isSelected) && (
                      <rect
                        x="-3"
                        y="-3"
                        width={CARD_W + 6}
                        height={CARD_H + 6}
                        rx="9"
                        fill="none"
                        stroke={isSelected ? '#3B82F6' : '#10B981'}
                        strokeOpacity={isProcessing ? '0.45' : '0.35'}
                        strokeWidth="2"
                      />
                    )}

                    {/* Node Card Body */}
                    <rect
                      width={CARD_W}
                      height={CARD_H}
                      rx="7"
                      fill="#111114"
                      stroke={borderColor}
                      strokeWidth={isSelected || isProcessing ? '1.6' : '1'}
                    />

                    {/* Top Header Strip */}
                    <rect
                      x="1"
                      y="1"
                      width={CARD_W - 2}
                      height="23"
                      rx="6"
                      fill="rgba(255,255,255,0.03)"
                    />

                    {/* Status Dot + Container Name + Port */}
                    <circle cx="13" cy="12.5" r="3.6" fill={statusColor} />
                    {isProcessing && (
                      <circle
                        cx="13"
                        cy="12.5"
                        r="7"
                        fill="none"
                        stroke="#10B981"
                        strokeWidth="1.2"
                        className="sys-node-pulse-ring"
                      />
                    )}
                    <text x="23" y="16" className="sys-node-container">
                      {node.container}
                    </text>
                    <text x={CARD_W - 10} y="16" textAnchor="end" className="sys-node-port">
                      {node.port}
                    </text>

                    {/* Title & Stack */}
                    <text x="11" y="42" className="sys-node-title">
                      {node.title}
                    </text>
                    <text x="11" y="56" className="sys-node-tech">
                      {node.tech}
                    </text>

                    {/* Bottom Telemetry / Processing Pill */}
                    <rect
                      x="9"
                      y="63"
                      width={CARD_W - 18}
                      height="15"
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
                      x="15"
                      y="73.5"
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

              {/* Animated In-Flight Message Packets (traveling along exact border-to-border polylines) */}
              {packets.map((pkt) => {
                const link = DIAGRAM_LINKS.find((l) => l.id === pkt.linkId);
                if (!link) return null;
                const [x, y] = pointAlongPolyline(link.points, pkt.progress);

                return (
                  <g
                    key={pkt.id}
                    transform={`translate(${x}, ${y})`}
                    className="sys-packet"
                    style={{ pointerEvents: 'none' }}
                  >
                    <circle r="5.5" fill={pkt.color} filter="url(#pkt-glow)" />
                    <circle r="2.2" fill="#FAFAFA" />
                    <g transform="translate(0, 16)">
                      <rect
                        x="-52"
                        y="-9"
                        width="104"
                        height="16"
                        rx="3"
                        fill="rgba(9, 9, 11, 0.94)"
                        stroke={pkt.color}
                        strokeWidth="1"
                      />
                      <text x="0" y="2" textAnchor="middle" className="sys-packet-label">
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
