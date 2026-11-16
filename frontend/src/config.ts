export const API_REST_URL = import.meta.env.VITE_API_REST_URL || 'http://localhost:8000';
export const EDGE_PROCESSOR_URL = import.meta.env.VITE_EDGE_PROCESSOR_URL || 'http://localhost:8001';
export const CV_MODULE_URL = import.meta.env.VITE_CV_MODULE_URL || 'http://localhost:8002';
export const VISUALIZATION_BACKEND_URL = import.meta.env.VITE_VISUALIZATION_BACKEND_URL || 'http://localhost:8003';
export const MONITORING_PIPELINE_URL = import.meta.env.VITE_MONITORING_PIPELINE_URL || 'http://localhost:8004';
export const AUTH_SERVICE_URL = import.meta.env.VITE_AUTH_SERVICE_URL || 'http://localhost:8005';
// Grafana (perfil observability): dashboards y alertas del sistema.
export const GRAFANA_URL = import.meta.env.VITE_GRAFANA_URL || 'http://localhost:3001';
