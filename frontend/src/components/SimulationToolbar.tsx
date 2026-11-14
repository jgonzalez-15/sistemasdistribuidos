import React from 'react';
import { RefreshCw, Shuffle, Zap } from 'lucide-react';

interface SimulationToolbarProps {
  simulationMode: 'normal' | 'concurrent_congestion';
  isAutoBatchActive: boolean;
  isDisabled: boolean;
  compact: boolean;
  onTriggerConcurrent: () => void;
  onResetMixed: () => void;
  onProcessBatch: () => void;
  onToggleAutoBatch: () => void;
}

export const SimulationToolbar: React.FC<SimulationToolbarProps> = ({
  simulationMode,
  isAutoBatchActive,
  isDisabled,
  compact,
  onTriggerConcurrent,
  onResetMixed,
  onProcessBatch,
  onToggleAutoBatch,
}) => (
  <div className={`sim-toolbar glass ${compact ? 'compact' : ''}`} role="toolbar" aria-label="Simulación">
    <button
      type="button"
      id="btn-concurrent-congestion"
      className={`sim-btn danger ${simulationMode === 'concurrent_congestion' ? 'active' : ''}`}
      onClick={onTriggerConcurrent}
      title="Congestión concurrente en múltiples arterias (escalado horizontal de workers RabbitMQ)"
    >
      <Zap size={14} strokeWidth={1.75} />
      <span className="sim-btn-label">Congestión</span>
    </button>
    <button
      type="button"
      id="btn-normal-traffic"
      className={`sim-btn ${simulationMode === 'normal' ? 'active' : ''}`}
      onClick={onResetMixed}
      title="Restablecer estado mixto"
    >
      <Shuffle size={14} strokeWidth={1.75} />
      <span className="sim-btn-label">Mixto</span>
    </button>

    <span className="sim-sep" />

    <button
      type="button"
      id="btn-next-batch"
      className="sim-btn primary"
      onClick={onProcessBatch}
      disabled={isDisabled}
      title="Procesar nuevo frame batch"
    >
      <RefreshCw size={14} strokeWidth={1.75} />
      <span className="sim-btn-label">Procesar Frame</span>
    </button>
    <button
      type="button"
      id="btn-auto-batch"
      className={`sim-btn ${isAutoBatchActive ? 'is-running' : ''}`}
      onClick={onToggleAutoBatch}
      disabled={isDisabled}
      aria-pressed={isAutoBatchActive}
      title="Procesar automáticamente un frame batch cada 1 segundo"
    >
      <span className="sim-toggle" />
      <span className="sim-btn-label-mono">Auto 1s</span>
    </button>
  </div>
);
