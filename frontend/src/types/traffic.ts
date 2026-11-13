export type UserRole = 'Administrador' | 'Operador';

export interface UserSession {
  username: string;
  role: UserRole;
  token: string;
  issuedAt: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
  role?: UserRole;
}

export type CongestionLevel = 'fluido' | 'moderado' | 'congestionado';

export interface StreetCorridor {
  name: string;
  /** Array of [lat, lng] coordinates representing the road segment around the intersection */
  coordinates: [number, number][];
}

export interface IntersectionSummary {
  id: string;
  name: string;
  zone: string;
  cameraCode: string;
  vehicleCount: number;
  maxCapacity: number;
  status: CongestionLevel;
  lastUpdated: string;
  workerNodeId: string;
  averageSpeedKmh: number;
  /** Real geographical coordinates in Montevideo [lat, lng] */
  coordinates: [number, number];
  /** Street segments extending from this intersection to color like Waze */
  streetCorridors: StreetCorridor[];
}

export interface TimeSeriesPoint {
  hour: string;
  timestamp: string;
  vehicles: number;
  thresholdCongestion: number;
  thresholdModerate: number;
}

export type TrafficPatternType = 'habitual' | 'anomalo';

export interface IntersectionAnalyticsDetail {
  intersection: IntersectionSummary;
  timeSeries: TimeSeriesPoint[];
  metrics: {
    congestionDurationMinutes: number;
    patternType: TrafficPatternType;
    patternLabel: string;
    patternDescription: string;
    peakHour: string;
    peakVehicles: number;
    avgVehiclesLast6h: number;
    queueStatus: 'activo' | 'reteniendo_eventos';
  };
}
