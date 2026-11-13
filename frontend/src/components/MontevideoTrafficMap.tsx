import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CongestionLevel, IntersectionSummary, StreetCorridor } from '../types/traffic';

interface MontevideoTrafficMapProps {
  intersections: IntersectionSummary[];
  selectedIntersectionId: string | null;
  onSelectIntersection: (id: string) => void;
  isSplitView: boolean;
}

const WAZE_STATUS_COLORS: Record<
  CongestionLevel,
  {
    coreLine: string;
    outerGlow: string;
    badgeBg: string;
    badgeBorder: string;
    label: string;
  }
> = {
  congestionado: {
    coreLine: '#ff3b30',
    outerGlow: '#991b1b',
    badgeBg: '#dc2626',
    badgeBorder: '#fca5a5',
    label: 'Congestionado',
  },
  moderado: {
    coreLine: '#ff9500',
    outerGlow: '#92400e',
    badgeBg: '#d97706',
    badgeBorder: '#fde68a',
    label: 'Tránsito Moderado',
  },
  fluido: {
    coreLine: '#30d158',
    outerGlow: '#065f46',
    badgeBg: '#059669',
    badgeBorder: '#a7f3d0',
    label: 'Tránsito Fluido',
  },
};

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function polylineLengthMeters(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(coords[i - 1], coords[i]);
  }
  return total;
}

/**
 * Finds a point along a corridor polyline that is between 95m and 175m from the intersection
 * center (preferring ~135m) so the speed shield sits directly on the road lane without
 * overlapping the central circular intersection marker.
 */
function pickShieldPointAlongCorridor(
  coords: [number, number][],
  center: [number, number]
): [number, number] | null {
  if (coords.length < 2) return null;

  // Sample interpolated points along every segment of the polyline
  const candidates: { pt: [number, number]; dist: number }[] = [];
  for (let i = 1; i < coords.length; i++) {
    const p1 = coords[i - 1];
    const p2 = coords[i];
    const segLen = haversineMeters(p1, p2);
    const steps = Math.max(2, Math.ceil(segLen / 20));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const pt: [number, number] = [
        p1[0] + (p2[0] - p1[0]) * t,
        p1[1] + (p2[1] - p1[1]) * t,
      ];
      candidates.push({ pt, dist: haversineMeters(pt, center) });
    }
  }

  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    // Target ~135m from intersection center
    const penalty = c.dist < 85 ? 500 + (85 - c.dist) * 10 : Math.abs(c.dist - 135);
    if (penalty < bestScore) {
      bestScore = penalty;
      best = c;
    }
  }
  return best ? best.pt : coords[Math.floor(coords.length / 2)];
}

function buildHoverCardHtml(item: IntersectionSummary): string {
  const palette = WAZE_STATUS_COLORS[item.status];
  const occupancyPct = Math.min(
    100,
    Math.round((item.vehicleCount / item.maxCapacity) * 100)
  );

  return `
    <div class="map-hover-card status-${item.status}">
      <div class="map-hover-card-header">
        <span class="map-hover-cam">${item.cameraCode} · ${item.zone}</span>
        <span class="map-hover-badge" style="background:${palette.badgeBg};border-color:${palette.badgeBorder}">
          ${palette.label}
        </span>
      </div>
      <div class="map-hover-title">${item.name}</div>
      <div class="map-hover-metrics">
        <div class="map-hover-count">
          <strong>${item.vehicleCount}</strong>
          <span>vehículos</span>
        </div>
        <div class="map-hover-speed">
          <strong>${item.averageSpeedKmh} km/h</strong>
          <span>vel. media (${occupancyPct}% cap.)</span>
        </div>
      </div>
      <div class="map-hover-bar-track">
        <div class="map-hover-bar-fill" style="width:${occupancyPct}%;background:${palette.coreLine}"></div>
      </div>
      <div class="map-hover-footer">
        <span>Actualizado: ${item.lastUpdated}</span>
        <span class="map-hover-cta">Clic para abrir panel →</span>
      </div>
    </div>
  `;
}

export const MontevideoTrafficMap: React.FC<MontevideoTrafficMapProps> = ({
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

  // Initialize Leaflet Map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [-34.895, -56.166],
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // OpenStreetMap official tile server (no API key required) styled into Waze Dark Mode via CSS
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      className: 'waze-dark-osm-tiles',
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;
    layerGroupRef.current = layerGroup;

    const syncZoomShieldVisibility = () => {
      const container = mapContainerRef.current;
      if (!container) return;
      if (map.getZoom() >= 15) {
        container.classList.add('waze-shields-visible');
      } else {
        container.classList.remove('waze-shields-visible');
      }
    };

    map.on('zoomend', syncZoomShieldVisibility);
    syncZoomShieldVisibility();

    return () => {
      map.off('zoomend', syncZoomShieldVisibility);
      map.remove();
      mapInstanceRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // Support optional ?focus=int-00X&zoom=17 query params in hash for street-level inspection
  useEffect(() => {
    const applyFocusFromHash = () => {
      const map = mapInstanceRef.current;
      if (!map || intersections.length === 0) return;

      const hashParts = window.location.hash.split('?');
      const queryStr = hashParts[1] || window.location.search.replace(/^\?/, '');
      if (!queryStr) return;

      const params = new URLSearchParams(queryStr);
      const focusId = params.get('focus');
      const zoomParam = Number(params.get('zoom') || '17');
      if (focusId) {
        const target = intersections.find((i) => i.id === focusId);
        if (target) {
          map.setView(target.coordinates, isNaN(zoomParam) ? 17 : zoomParam, {
            animate: false,
          });
        }
      }
    };

    applyFocusFromHash();
    window.addEventListener('hashchange', applyFocusFromHash);
    return () => window.removeEventListener('hashchange', applyFocusFromHash);
  }, [intersections]);

  // Keep Leaflet viewport smoothly resized during Apple-style split-screen CSS transition
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapContainerRef.current) return;

    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(mapContainerRef.current);

    // Also trigger timed invalidations during the 550ms spring transition
    const t1 = setTimeout(() => map.invalidateSize({ animate: true }), 180);
    const t2 = setTimeout(() => map.invalidateSize({ animate: true }), 560);

    return () => {
      observer.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isSplitView]);

  // Fly smoothly to selected intersection when chosen
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (selectedIntersectionId) {
      const target = intersectionsRef.current.find(
        (i) => i.id === selectedIntersectionId
      );
      if (target) {
        map.flyTo(target.coordinates, Math.max(map.getZoom(), 15), {
          animate: true,
          duration: 0.65,
        });
      }
    }
  }, [selectedIntersectionId]);

  // Render Waze-style colored street corridors, speed badges, and interactive intersection nodes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    intersections.forEach((intersection) => {
      const palette = WAZE_STATUS_COLORS[intersection.status];
      const isSelected = intersection.id === selectedIntersectionId;
      const handleCorridorClick = () => onSelectIntersection(intersection.id);

      // Track longest corridor per distinct street name so we place exactly 1 clean speed shield per street
      const longestByStreet = new Map<string, { corridor: StreetCorridor; len: number }>();

      // 1. Draw Waze-style colored street segments extending along exact OSM road geometry
      intersection.streetCorridors.forEach((corridor) => {
        const len = polylineLengthMeters(corridor.coordinates);
        const prev = longestByStreet.get(corridor.name);
        if (!prev || len > prev.len) {
          longestByStreet.set(corridor.name, { corridor, len });
        }

        // Outer glow halo along the street lane
        const glowLine = L.polyline(corridor.coordinates, {
          color: palette.outerGlow,
          weight: isSelected ? 12 : 9,
          opacity: isSelected ? 0.58 : 0.4,
          lineCap: 'round',
          lineJoin: 'round',
        });

        // Core bright Waze traffic line aligned directly onto OSM roadway
        const coreLine = L.polyline(corridor.coordinates, {
          color: palette.coreLine,
          weight: isSelected ? 6 : 4.5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        });

        // Directional flow dashes overlay
        const flowDashes = L.polyline(corridor.coordinates, {
          color: '#ffffff',
          weight: 1.5,
          opacity: intersection.status === 'congestionado' ? 0.5 : 0.28,
          dashArray: '4, 14',
          lineCap: 'round',
        });

        glowLine.on('click', handleCorridorClick);
        coreLine.on('click', handleCorridorClick);

        coreLine.bindTooltip(buildHoverCardHtml(intersection), {
          direction: 'top',
          sticky: true,
          className: 'waze-custom-tooltip-wrapper',
          opacity: 1,
          offset: [0, -10],
        });

        layerGroup.addLayer(glowLine);
        layerGroup.addLayer(coreLine);
        layerGroup.addLayer(flowDashes);
      });

      // Place 1 crisp speed shield per distinct street name (~135m from the intersection node)
      longestByStreet.forEach(({ corridor }) => {
        const shieldPos = pickShieldPointAlongCorridor(
          corridor.coordinates,
          intersection.coordinates
        );
        if (!shieldPos) return;

        const shieldIcon = L.divIcon({
          className: 'waze-speed-shield-container',
          html: `
            <div class="waze-speed-shield status-${intersection.status}">
              <span class="shield-num">${intersection.averageSpeedKmh}</span>
              <span class="shield-unit">km/h</span>
            </div>
          `,
          iconSize: [38, 28],
          iconAnchor: [19, 14],
        });

        const shieldMarker = L.marker(shieldPos, {
          icon: shieldIcon,
          interactive: true,
          zIndexOffset: 400,
        });
        shieldMarker.on('click', handleCorridorClick);
        layerGroup.addLayer(shieldMarker);
      });

      // 2. Draw Interactive Intersection Node Pin (with pulse + hover card + click to open side panel)
      const nodeHtml = `
        <div class="waze-intersection-node status-${intersection.status} ${
        isSelected ? 'is-selected' : ''
      }" data-testid="map-node-${intersection.id}">
          <span class="node-pulse-ring"></span>
          <div class="node-core-circle">
            <span class="node-count-text">${intersection.vehicleCount}</span>
          </div>
        </div>
      `;

      const nodeIcon = L.divIcon({
        className: 'waze-node-icon-wrapper',
        html: nodeHtml,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });

      const marker = L.marker(intersection.coordinates, {
        icon: nodeIcon,
        zIndexOffset: isSelected ? 1000 : 500,
      });

      // Hidden by default; shown on hover over the intersection point
      marker.bindTooltip(buildHoverCardHtml(intersection), {
        direction: 'top',
        offset: [0, -24],
        opacity: 1,
        className: 'waze-custom-tooltip-wrapper',
        permanent: false,
      });

      marker.on('click', () => {
        onSelectIntersection(intersection.id);
      });

      layerGroup.addLayer(marker);
    });
  }, [intersections, selectedIntersectionId, onSelectIntersection]);

  return (
    <div className="montevideo-map-wrapper">
      <div
        ref={mapContainerRef}
        className="leaflet-map-canvas"
        id="montevideo-traffic-map"
      />
    </div>
  );
};
