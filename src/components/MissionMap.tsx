import React, { useRef, useEffect, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Same local-tangent-plane convention used by CesiumTerrainMapView, so both
// map modes agree on where the drone actually is.
const DEFAULT_REF_LAT = 26.99484;
const DEFAULT_REF_LON = 88.28542;
const METER_PER_DEG_LAT = 111320.0;

function nedToLatLng(north: number, east: number, refLat: number, refLon: number): [number, number] {
  const lat = refLat + north / METER_PER_DEG_LAT;
  const lon = refLon + east / (METER_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180));
  return [lat, lon];
}

interface MissionMapProps {
  north: number;
  east: number;
  yaw: number;
  isLocked: boolean;
  className?: string;
  lat?: number;
  lon?: number;
  flightPath?: Array<{ north: number; east: number; alt: number }>;
  waypoints?: Array<{ north: number; east: number; alt?: number; label?: string }>;
  searchCenter?: { north: number; east: number } | null;
  searchRadius?: number;
}

// Bearing-rotated drone glyph as a divIcon so it renders crisply at any zoom
// and tints instantly with survivor-lock state, without a sprite asset.
function droneDivIcon(yaw: number, isLocked: boolean): L.DivIcon {
  const color = isLocked ? '#22c55e' : '#9ca3af';
  const glow = isLocked ? `<circle cx="16" cy="16" r="13" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.35"/>` : '';
  return L.divIcon({
    className: 'drone-marker',
    html: `<svg width="32" height="32" viewBox="0 0 32 32" style="transform: rotate(${yaw}deg)">
      ${glow}
      <path d="M16 5 L22 24 L16 20 L10 24 Z" fill="${color}" stroke="#000" stroke-width="0.5" stroke-opacity="0.4"/>
    </svg>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

const homeDivIcon = L.divIcon({
  className: 'home-marker',
  html: `<svg width="20" height="20" viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="7" fill="none" stroke="#666666" stroke-width="1.5" stroke-dasharray="3,3"/>
  </svg>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function waypointDivIcon(label?: string): L.DivIcon {
  return L.divIcon({
    className: 'wp-marker',
    html: `<div style="display:flex;align-items:center;justify-content:center;width:16px;height:16px;border:1.5px solid #d97706;border-radius:2px;background:rgba(217,119,6,0.15);color:#d97706;font:bold 8px monospace;">${label ?? ''}</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export const MissionMap: React.FC<MissionMapProps> = ({
  north, east, yaw, isLocked, className = '',
  lat: telemetryLat, lon: telemetryLon,
  flightPath = [], waypoints = [], searchCenter = null, searchRadius = 100,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const droneMarkerRef = useRef<L.Marker | null>(null);
  const homeMarkerRef = useRef<L.Marker | null>(null);
  const pathLineRef = useRef<L.Polyline | null>(null);
  const waypointMarkersRef = useRef<L.Marker[]>([]);
  const searchCircleRef = useRef<L.Circle | null>(null);
  const refCoordsRef = useRef<{ lat: number; lon: number }>({ lat: DEFAULT_REF_LAT, lon: DEFAULT_REF_LON });
  const hasCenteredRef = useRef(false);

  const getRefCoords = useCallback(() => {
    if (telemetryLat && telemetryLon && (telemetryLat !== 0 || telemetryLon !== 0)) {
      const derivedLat = telemetryLat - north / METER_PER_DEG_LAT;
      const cosLat = Math.cos((derivedLat * Math.PI) / 180);
      const derivedLon = telemetryLon - east / (METER_PER_DEG_LAT * cosLat);
      refCoordsRef.current = { lat: derivedLat, lon: derivedLon };
    }
    return refCoordsRef.current;
  }, [north, east, telemetryLat, telemetryLon]);

  // Mount map once
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const ref = getRefCoords();
    const map = L.map(container, {
      center: [ref.lat, ref.lon],
      zoom: 17,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });

    // Esri World Imagery — free, no API key, real satellite resolution down
    // to district/street level. Swap this URL if a different provider is
    // preferred; no other code here depends on the tile source.
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
    }).addTo(map);

    // Dark-glass-themed zoom control, bottom-right so it clears the HUD dock
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    homeMarkerRef.current = L.marker([ref.lat, ref.lon], { icon: homeDivIcon }).addTo(map);
    droneMarkerRef.current = L.marker([ref.lat, ref.lon], { icon: droneDivIcon(0, false), zIndexOffset: 1000 }).addTo(map);
    pathLineRef.current = L.polyline([], { color: '#22c55e', weight: 2, opacity: 0.7 }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update drone position/heading every telemetry tick
  useEffect(() => {
    const map = mapRef.current;
    const droneMarker = droneMarkerRef.current;
    if (!map || !droneMarker) return;

    const ref = getRefCoords();
    const [dlat, dlon] = nedToLatLng(north, east, ref.lat, ref.lon);
    droneMarker.setLatLng([dlat, dlon]);
    droneMarker.setIcon(droneDivIcon(yaw, isLocked));

    if (homeMarkerRef.current) homeMarkerRef.current.setLatLng([ref.lat, ref.lon]);

    if (!hasCenteredRef.current) {
      map.setView([dlat, dlon], 17);
      hasCenteredRef.current = true;
    }
  }, [north, east, yaw, isLocked, getRefCoords]);

  // Flight path trail
  useEffect(() => {
    const line = pathLineRef.current;
    if (!line) return;
    const ref = getRefCoords();
    line.setLatLngs(flightPath.map(p => nedToLatLng(p.north, p.east, ref.lat, ref.lon)));
  }, [flightPath, getRefCoords]);

  // Waypoint markers — rebuilt when the active mission plan changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    waypointMarkersRef.current.forEach(m => m.remove());
    const ref = getRefCoords();
    waypointMarkersRef.current = waypoints.map(wp => {
      const [wlat, wlon] = nedToLatLng(wp.north, wp.east, ref.lat, ref.lon);
      return L.marker([wlat, wlon], { icon: waypointDivIcon(wp.label) }).addTo(map);
    });
    return () => { waypointMarkersRef.current.forEach(m => m.remove()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints]);

  // Active search-pattern radius overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (searchCircleRef.current) { searchCircleRef.current.remove(); searchCircleRef.current = null; }
    if (!searchCenter) return;
    const ref = getRefCoords();
    const [slat, slon] = nedToLatLng(searchCenter.north, searchCenter.east, ref.lat, ref.lon);
    searchCircleRef.current = L.circle([slat, slon], {
      radius: searchRadius, color: '#0ea5e9', weight: 1.5, fillColor: '#0ea5e9', fillOpacity: 0.08, dashArray: '4,4',
    }).addTo(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCenter, searchRadius]);

  return (
    <div ref={containerRef} className={`absolute inset-0 leaflet-dark-theme ${className}`} />
  );
};
