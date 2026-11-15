import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CongestionLevel, IntersectionSummary } from '../types/traffic';

interface TrafficMapProps {
  intersections: IntersectionSummary[];
  selectedIntersectionId: string | null;
  onSelectIntersection: (id: string) => void;
  isSplitView: boolean;
}

const STATUS_COLORS: Record<CongestionLevel, { line: string; label: string }> = {
  congestionado: { line: '#EF4444', label: 'Crítico' },
  moderado: { line: '#F59E0B', label: 'Moderado' },
  fluido: { line: '#10B981', label: 'Fluido' },
  sin_datos: { line: '#71717A', label: 'Sin datos' },
};

function buildHoverCardHtml(item: IntersectionSummary): string {
  const palette = STATUS_COLORS[item.status] || STATUS_COLORS.sin_datos;
  const isNoData = item.status === 'sin_datos';
  const occupancyPct = isNoData
    ? 0
    : Math.min(100, Math.round((item.vehicleCount / item.maxCapacity) * 100));

  return `
    <div class="tm-hover-card">
      <div class="tm-hover-meta">
        <span>${item.cameraCode} · ${item.zone.toUpperCase()}</span>
        <span class="tm-hover-status"><span class="status-dot ${item.status}"></span>${palette.label}</span>
      </div>
      <div class="tm-hover-title">${item.name}</div>
      <div class="tm-hover-kpis">
        <div class="tm-hover-kpi"><strong>${isNoData ? '—' : item.vehicleCount}</strong><span>VEH VIS.</span></div>
        <div class="tm-hover-kpi"><strong>${isNoData ? '—' : item.averageSpeedKmh}</strong><span>KM/H</span></div>
        <div class="tm-hover-kpi"><strong>${isNoData ? 'SIN DATOS' : `${occupancyPct}%`}</strong><span>${
          isNoData ? item.lastUpdated.toUpperCase() : 'DENSIDAD'
        }</span></div>
      </div>
      <div class="tm-hover-bar"><div style="width:${occupancyPct}%;background:${palette.line}"></div></div>
    </div>
  `;
}

export const TrafficMap: React.FC<TrafficMapProps> = ({
  intersections,
  selectedIntersectionId,
  onSelectIntersection,
  isSplitView,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const intersectionsRef = useRef<IntersectionSummary[]>(intersections);
  intersectionsRef.current = intersections;

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [-34.895, -56.166],
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Official OpenStreetMap tiles (no API key). Neutralised to charcoal via CSS on .leaflet-tile-pane
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;
    layerGroupRef.current = layerGroup;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // Optional ?focus=int-00X&zoom=17 for street-level inspection
  useEffect(() => {
    const applyFocusFromHash = () => {
      const map = mapInstanceRef.current;
      if (!map || intersections.length === 0) return;
      const queryStr = window.location.hash.split('?')[1] || window.location.search.replace(/^\?/, '');
      if (!queryStr) return;
      const params = new URLSearchParams(queryStr);
      const focusId = params.get('focus');
      const zoomParam = Number(params.get('zoom') || '17');
      const target = focusId ? intersections.find((i) => i.id === focusId) : undefined;
      if (target) {
        map.setView(target.coordinates, isNaN(zoomParam) ? 17 : zoomParam, { animate: false });
      }
    };
    applyFocusFromHash();
    window.addEventListener('hashchange', applyFocusFromHash);
    return () => window.removeEventListener('hashchange', applyFocusFromHash);
  }, [intersections]);

  // Keep viewport in sync during split-screen spring transition
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapContainerRef.current) return;
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(mapContainerRef.current);
    const t1 = setTimeout(() => map.invalidateSize({ animate: true }), 180);
    const t2 = setTimeout(() => map.invalidateSize({ animate: true }), 580);
    return () => {
      observer.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isSplitView]);

  // Fly to selected intersection
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedIntersectionId) return;
    const target = intersectionsRef.current.find((i) => i.id === selectedIntersectionId);
    if (target) {
      map.flyTo(target.coordinates, Math.max(map.getZoom(), 15), { animate: true, duration: 0.65 });
    }
  }, [selectedIntersectionId]);

  // Render corridors + telemetry markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    intersections.forEach((intersection) => {
      const palette = STATUS_COLORS[intersection.status];
      const isSelected = intersection.id === selectedIntersectionId;
      const handleSelect = () => onSelectIntersection(intersection.id);
      const hoverHtml = buildHoverCardHtml(intersection);

      intersection.streetCorridors.forEach((corridor) => {
        const halo = L.polyline(corridor.coordinates, {
          color: palette.line,
          weight: isSelected ? 12 : 9,
          opacity: isSelected ? 0.22 : 0.14,
          lineCap: 'round',
          lineJoin: 'round',
        });
        const core = L.polyline(corridor.coordinates, {
          color: palette.line,
          weight: isSelected ? 4.5 : 3.25,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        });
        const flow = L.polyline(corridor.coordinates, {
          color: '#FAFAFA',
          weight: 1,
          opacity: intersection.status === 'congestionado' ? 0.45 : 0.25,
          dashArray: '2, 12',
          lineCap: 'round',
          interactive: false,
        });

        halo.on('click', handleSelect);
        core.on('click', handleSelect);
        core.bindTooltip(hoverHtml, {
          direction: 'top',
          sticky: true,
          className: 'tm-tooltip',
          opacity: 1,
          offset: [0, -10],
        });

        layerGroup.addLayer(halo);
        layerGroup.addLayer(core);
        layerGroup.addLayer(flow);
      });

      const isNoData = intersection.status === 'sin_datos';
      const markerHtml = `
        <div class="tm-marker ${intersection.status} ${isSelected ? 'is-selected' : ''}" data-testid="map-node-${intersection.id}">
          <span class="tm-marker-core">${isNoData ? '—' : intersection.vehicleCount}</span>
          <span class="tm-marker-speed">${
            isNoData ? '<small>SIN DATOS</small>' : `${intersection.averageSpeedKmh}<small>KM/H</small>`
          }</span>
        </div>
      `;

      const marker = L.marker(intersection.coordinates, {
        icon: L.divIcon({
          className: 'tm-marker-icon',
          html: markerHtml,
          iconSize: [92, 22],
          iconAnchor: [15, 11],
        }),
        zIndexOffset: isSelected ? 1000 : 500,
      });

      marker.bindTooltip(hoverHtml, {
        direction: 'top',
        offset: [30, -16],
        opacity: 1,
        className: 'tm-tooltip',
      });
      marker.on('click', handleSelect);
      layerGroup.addLayer(marker);
    });
  }, [intersections, selectedIntersectionId, onSelectIntersection]);

  return (
    <div className="map-canvas-wrap">
      <div ref={mapContainerRef} className="map-canvas" id="montevideo-traffic-map" />
    </div>
  );
};
