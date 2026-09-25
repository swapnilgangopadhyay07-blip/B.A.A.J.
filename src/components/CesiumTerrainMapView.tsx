import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Viewer,
  Ion,
  Color,
  Cartesian3,
  Cartographic,
  sampleTerrainMostDetailed,
  createWorldTerrainAsync,
  createWorldImageryAsync,
  IonWorldImageryStyle,
  HeightReference,
  Cartesian2,
  Math as CesiumMath,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { ConnectionState, Telemetry } from '../types';
import { isValidTelemetry } from '../api';

const rawToken = (
  (import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined) ||
  Ion.defaultAccessToken
)?.replace(/^<|>$/g, '').trim();

if (rawToken) {
  Ion.defaultAccessToken = rawToken;
}

const DEFAULT_REF_LAT = 26.99484;
const DEFAULT_REF_LON = 88.28542;
const METER_PER_DEG_LAT = 111320.0;
const DEMISMATCH_CHECK_INTERVAL_MS = 10000;
const DEMISMATCH_CHECK_INTERVAL_M = 50;
const TERRAIN_MISMATCH_WARN = 10;
const TERRAIN_MISMATCH_SEVERE = 20;
const CAMERA_HEIGHT_AGL = 1200;

function simulinkDemElev(north: number, east: number): number {
  return (
    2.4 * Math.sin(0.035 * north) * Math.cos(0.035 * east) +
    1.2 * Math.sin(0.07 * north)
  );
}

function nedToDegrees(north: number, east: number, refLat: number, refLon: number): { lat: number; lon: number } {
  const lat = refLat + north / METER_PER_DEG_LAT;
  const lon = refLon + east / (METER_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180));
  return { lat, lon };
}

export interface CesiumTerrainMapViewProps {
  telemetry: Telemetry | null;
  lat: number;
  lon: number;
  north: number;
  east: number;
  alt: number;
  yaw: number;
  isLocked: boolean;
  connectionState: ConnectionState;
  className?: string;
  flightPath?: Array<{ north: number; east: number; alt: number }>;
  waypoints?: Array<{ north: number; east: number; alt?: number; label?: string }>;
  searchCenter?: { north: number; east: number } | null;
  searchRadius?: number;
  targetFlyTo?: { lat: number; lon: number; ts: number } | null;
}

export const CesiumTerrainMapView: React.FC<CesiumTerrainMapViewProps> = ({
  telemetry,
  lat: telemetryLat,
  lon: telemetryLon,
  north,
  east,
  alt,
  yaw,
  isLocked,
  connectionState,
  className = '',
  flightPath = [],
  waypoints = [],
  searchCenter = null,
  searchRadius = 100,
  targetFlyTo = null,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const droneEntityRef = useRef<any>(null);
  const homeEntityRef = useRef<any>(null);
  const flightPathEntityRef = useRef<any>(null);
  const waypointEntitiesRef = useRef<any[]>([]);
  const searchEntityRef = useRef<any>(null);
  const terrainProviderRef = useRef<any>(null);
  const refCoordsRef = useRef<{ lat: number; lon: number }>({ lat: DEFAULT_REF_LAT, lon: DEFAULT_REF_LON });
  const lastMismatchCheckRef = useRef<{ north: number; east: number; time: number }>({ north: Infinity, east: Infinity, time: 0 });

  const [loadError, setLoadError] = useState<string | null>(null);
  const [terrainMismatch, setTerrainMismatch] = useState<number | null>(null);
  const [isViewerReady, setIsViewerReady] = useState(false);
  const hasReceivedValidDataRef = useRef(false);
  const hasDoneInitialFlyToRef = useRef(false);

  // Derive reference coordinates or use default
  const getRefCoords = useCallback(() => {
    if (telemetryLat && telemetryLon && (telemetryLat !== 0 || telemetryLon !== 0)) {
      const derivedLat = telemetryLat - north / METER_PER_DEG_LAT;
      const cosLat = Math.cos((derivedLat * Math.PI) / 180);
      const derivedLon = telemetryLon - east / (METER_PER_DEG_LAT * cosLat);
      refCoordsRef.current = { lat: derivedLat, lon: derivedLon };
    }
    return refCoordsRef.current;
  }, [north, east, telemetryLat, telemetryLon]);

  // Mount and initialize Cesium viewer immediately
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const token = Ion.defaultAccessToken || rawToken;
    if (!token) {
      setLoadError('MISSING_TOKEN');
      return;
    }
    Ion.defaultAccessToken = token;

    let isMounted = true;

    const initViewer = async () => {
      try {
        const viewer = new Viewer(containerRef.current!, {
          baseLayer: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          vrButton: false,
          infoBox: false,
          requestRenderMode: false,
          msaaSamples: 4,
          contextOptions: {
            webgl: {
              alpha: false,
              depth: true,
              stencil: true,
              antialias: true,
              premultipliedAlpha: true,
              preserveDrawingBuffer: false,
              failIfMajorPerformanceCaveat: false,
            },
          },
        } as any);

        if (!isMounted) {
          viewer.destroy();
          return;
        }

        viewerRef.current = viewer;

        // Visual setup for dark tactical HUD
        viewer.scene.backgroundColor = Color.fromCssColorString('#0c0c0c');
        viewer.scene.globe.baseColor = Color.fromCssColorString('#0c0c0c');
        viewer.scene.globe.depthTestAgainstTerrain = true;
        viewer.scene.globe.enableLighting = false;

        // 1. High-resolution Satellite Imagery WITH LABELS
        try {
          const imageryProvider = await createWorldImageryAsync({
            style: IonWorldImageryStyle.AERIAL_WITH_LABELS,
          });
          if (isMounted && viewerRef.current) {
            viewer.imageryLayers.addImageryProvider(imageryProvider as any);
          }
        } catch {
          try {
            const fallbackImagery = await createWorldImageryAsync({
              style: IonWorldImageryStyle.AERIAL,
            });
            if (isMounted && viewerRef.current) {
              viewer.imageryLayers.addImageryProvider(fallbackImagery as any);
            }
          } catch {
            // Imagery unavailable — baseColor provides fallback
          }
        }

        // 2. High-resolution 3D World Terrain Mesh
        try {
          const terrainProvider = await createWorldTerrainAsync({
            requestWaterMask: true,
            requestVertexNormals: true,
          });
          if (isMounted && viewerRef.current) {
            terrainProviderRef.current = terrainProvider;
            viewer.scene.terrainProvider = terrainProvider;
          }
        } catch {
          // Terrain unavailable — flat globe fallback
        }

        // 3. Initial camera position
        const initialLat = (telemetryLat && telemetryLat !== 0) ? telemetryLat : DEFAULT_REF_LAT;
        const initialLon = (telemetryLon && telemetryLon !== 0) ? telemetryLon : DEFAULT_REF_LON;

        viewer.camera.setView({
          destination: Cartesian3.fromDegrees(initialLon, initialLat, 2800),
          orientation: {
            heading: CesiumMath.toRadians(0),
            pitch: CesiumMath.toRadians(-72),
            roll: 0.0,
          },
        });

        // Hide Cesium logo/credit
        setTimeout(() => {
          const credit = containerRef.current?.querySelector('.cesium-viewer-bottom') as HTMLElement;
          if (credit) credit.style.display = 'none';
        }, 300);

        // Force a render pass after async initialization
        viewer.scene.requestRender();

        if (isMounted) {
          setIsViewerReady(true);
          setLoadError(null);
        }
      } catch (err) {
        if (isMounted) {
          setLoadError(err instanceof Error ? err.message : 'INIT_FAILED');
        }
      }
    };

    initViewer();

    return () => {
      isMounted = false;
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
      droneEntityRef.current = null;
      homeEntityRef.current = null;
      flightPathEntityRef.current = null;
      waypointEntitiesRef.current = [];
      searchEntityRef.current = null;
    };
  }, []);

  // External flyTo request (e.g. from search bar)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !targetFlyTo) return;

    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(targetFlyTo.lon, targetFlyTo.lat, 2500),
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-75),
        roll: 0.0,
      },
      duration: 1.5,
    });
  }, [targetFlyTo]);

  // Update drone position, HOME marker, and follow camera on telemetry updates
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const ref = getRefCoords();
    const { lat: droneLat, lon: droneLon } = nedToDegrees(north, east, ref.lat, ref.lon);

    // Initial fly-to once telemetry coordinates arrive
    if (!hasDoneInitialFlyToRef.current && telemetryLat && telemetryLon && (telemetryLat !== 0 || telemetryLon !== 0)) {
      hasDoneInitialFlyToRef.current = true;
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(droneLon, droneLat, 2400),
        orientation: {
          heading: CesiumMath.toRadians(0),
          pitch: CesiumMath.toRadians(-75),
          roll: 0.0,
        },
        duration: 1.5,
      });
    }

    const updateDroneAndHome = async () => {
      let groundHeight = 0;
      if (terrainProviderRef.current) {
        try {
          const positions = [Cartographic.fromDegrees(droneLon, droneLat, 0)];
          await sampleTerrainMostDetailed(terrainProviderRef.current, positions);
          if (positions[0]?.height && Number.isFinite(positions[0].height)) {
            groundHeight = positions[0].height;
          }
        } catch {
          // Fallback to ground 0
        }
      }

      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;

      const simulinkDemAtDrone = simulinkDemElev(north, east);
      const droneHeight = groundHeight + Math.max(0, alt) - simulinkDemAtDrone + 2;
      const dronePos = Cartesian3.fromDegrees(droneLon, droneLat, Math.max(0, droneHeight));

      // Drone 3D entity
      if (!droneEntityRef.current) {
        droneEntityRef.current = viewer.entities.add({
          name: 'SAR_DRONE',
          position: dronePos,
          point: {
            pixelSize: 14,
            color: isLocked ? Color.fromCssColorString('#ef4444') : Color.fromCssColorString('#22c55e'),
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `SAR-01 | ALT ${alt.toFixed(1)}m`,
            font: 'bold 10px monospace',
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            style: 2 as any,
            pixelOffset: new Cartesian2(0, -22) as any,
            showBackground: true,
            backgroundColor: Color.fromCssColorString('#0c0c0cE6'),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      } else {
        droneEntityRef.current.position = dronePos;
        droneEntityRef.current.point.color = isLocked
          ? Color.fromCssColorString('#ef4444')
          : Color.fromCssColorString('#22c55e');
        droneEntityRef.current.label.text = `SAR-01 | ALT ${alt.toFixed(1)}m`;
      }

      // HOME Base marker
      if (!homeEntityRef.current) {
        const homePos = Cartesian3.fromDegrees(ref.lon, ref.lat, Math.max(0, groundHeight));
        homeEntityRef.current = viewer.entities.add({
          name: 'HOME_BASE',
          position: homePos,
          point: {
            pixelSize: 10,
            color: Color.fromCssColorString('#3b82f6'),
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: 'HOME BASE',
            font: 'bold 10px monospace',
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            style: 2 as any,
            pixelOffset: new Cartesian2(0, -18) as any,
            showBackground: true,
            backgroundColor: Color.fromCssColorString('#0c0c0cE6'),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    };

    updateDroneAndHome();
  }, [north, east, alt, isLocked, telemetryLat, telemetryLon, getRefCoords]);

  // Real-time flight path trail polyline
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || flightPath.length < 2) return;

    const ref = getRefCoords();
    const positions = flightPath.map((p) => {
      const { lat, lon } = nedToDegrees(p.north, p.east, ref.lat, ref.lon);
      return Cartesian3.fromDegrees(lon, lat, Math.max(0, p.alt + 2));
    });

    if (!flightPathEntityRef.current) {
      flightPathEntityRef.current = viewer.entities.add({
        polyline: {
          positions,
          width: 3,
          material: Color.fromCssColorString('#22c55ecc'),
          clampToGround: false,
        },
      });
    } else {
      flightPathEntityRef.current.polyline.positions = positions;
    }
  }, [flightPath, getRefCoords]);

  // Waypoint markers in 3D
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    waypointEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
    waypointEntitiesRef.current = [];

    const ref = getRefCoords();
    waypoints.forEach((wp, i) => {
      const { lat, lon } = nedToDegrees(wp.north, wp.east, ref.lat, ref.lon);
      const wpAlt = wp.alt ?? 14;
      const entity = viewer.entities.add({
        position: Cartesian3.fromDegrees(lon, lat, Math.max(0, wpAlt + 2)),
        point: {
          pixelSize: 8,
          color: Color.fromCssColorString('#f59e0b'),
          outlineColor: Color.WHITE,
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: wp.label ?? `WP${i + 1}`,
          font: 'bold 9px monospace',
          fillColor: Color.fromCssColorString('#f59e0b'),
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: 2 as any,
          pixelOffset: new Cartesian2(0, -16) as any,
          showBackground: true,
          backgroundColor: Color.fromCssColorString('#0c0c0cE6'),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      waypointEntitiesRef.current.push(entity);
    });
  }, [waypoints, getRefCoords]);

  // Search radius overlay in 3D
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    if (searchEntityRef.current) {
      viewer.entities.remove(searchEntityRef.current);
      searchEntityRef.current = null;
    }

    if (!searchCenter || searchRadius <= 0) return;

    const ref = getRefCoords();
    const { lat, lon } = nedToDegrees(searchCenter.north, searchCenter.east, ref.lat, ref.lon);

    searchEntityRef.current = viewer.entities.add({
      position: Cartesian3.fromDegrees(lon, lat, 0),
      ellipse: {
        semiMajorAxis: searchRadius,
        semiMinorAxis: searchRadius,
        material: Color.fromCssColorString('#f59e0b33'),
        outline: true,
        outlineColor: Color.fromCssColorString('#f59e0bcc'),
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
    });
  }, [searchCenter, searchRadius, getRefCoords]);

  // Terrain mismatch monitoring
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !terrainProviderRef.current) return;

    const now = Date.now();
    const distFromLastCheck = Math.hypot(
      north - lastMismatchCheckRef.current.north,
      east - lastMismatchCheckRef.current.east
    );
    if (distFromLastCheck < DEMISMATCH_CHECK_INTERVAL_M && now - lastMismatchCheckRef.current.time < DEMISMATCH_CHECK_INTERVAL_MS) {
      return;
    }

    lastMismatchCheckRef.current = { north, east, time: now };

    const ref = getRefCoords();
    const { lat: droneLat, lon: droneLon } = nedToDegrees(north, east, ref.lat, ref.lon);
    const { lat: homeLat, lon: homeLon } = ref;

    const dronePositions = [Cartographic.fromDegrees(droneLon, droneLat, 0)];
    const homePositions = [Cartographic.fromDegrees(homeLon, homeLat, 0)];

    Promise.all([
      sampleTerrainMostDetailed(terrainProviderRef.current, dronePositions),
      sampleTerrainMostDetailed(terrainProviderRef.current, homePositions),
    ]).then(() => {
      const cesiumTerrainAtDrone = dronePositions[0].height;
      const cesiumTerrainAtHome = homePositions[0].height;
      const cesiumDelta = cesiumTerrainAtDrone - cesiumTerrainAtHome;
      const simulinkDelta = simulinkDemElev(north, east) - simulinkDemElev(0, 0);
      const divergence = Math.abs(cesiumDelta - simulinkDelta);
      setTerrainMismatch(divergence > 0.5 ? divergence : null);
    }).catch(() => {
      // Ignored
    });
  }, [north, east, getRefCoords]);

  if (loadError === 'MISSING_TOKEN') {
    return (
      <div className={`${className} flex flex-col items-center justify-center bg-base text-xs text-center p-6 gap-3 select-none`}>
        <div className="glass-panel px-6 py-4 flex flex-col items-center gap-2 max-w-md border border-amber/40">
          <span className="text-amber font-bold tracking-widest uppercase text-xs">CESIUM ION TOKEN MISSING</span>
          <span className="text-text-dim text-[11px] leading-relaxed">
            Add <span className="text-text font-mono bg-raised px-1 py-0.5 border border-border">VITE_CESIUM_ION_TOKEN</span> to{' '}
            <span className="text-text font-mono bg-raised px-1 py-0.5 border border-border">.env.local</span> to enable 3D terrain view.
          </span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`${className} flex flex-col items-center justify-center bg-base text-xs text-center p-6 gap-3 select-none`}>
        <div className="glass-panel px-6 py-4 flex flex-col items-center gap-2 max-w-md border border-red/40">
          <span className="text-red font-bold tracking-widest uppercase text-xs">3D TERRAIN UNAVAILABLE</span>
          <span className="text-text-dim text-[11px] leading-relaxed">
            Failed to initialize Cesium: {loadError}. Check API key and billing.
          </span>
        </div>
      </div>
    );
  }

  if (telemetry && isValidTelemetry(telemetry) && !hasReceivedValidDataRef.current) {
    hasReceivedValidDataRef.current = true;
  }

  const hasValidData = hasReceivedValidDataRef.current;
  const isStale = hasValidData && (connectionState === 'STALE' || connectionState === 'BRIDGE_ONLY');

  return (
    <div className={className}>
      {/* 3D Native Cesium Canvas Container — Always mounted immediately */}
      <div ref={containerRef} className="absolute inset-0 pointer-events-auto overflow-hidden" />

      {/* Awaiting telemetry badge — subtle tactical status banner */}
      {!hasValidData && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="glass-panel px-4 py-1.5 flex items-center gap-2 border border-amber/40 bg-base/80">
            <span className="w-2 h-2 rounded-full bg-amber animate-ping" />
            <span className="text-amber font-mono font-bold text-[11px] uppercase tracking-wider">
              {connectionState === 'CONNECTING' && 'CONNECTING TO BRIDGE...'}
              {connectionState === 'DISCONNECTED' && 'LINK OFFLINE — 3D TERRAIN READY'}
              {connectionState === 'BRIDGE_ONLY' && 'WAITING FOR DRONE TELEMETRY'}
              {!['CONNECTING', 'DISCONNECTED', 'BRIDGE_ONLY'].includes(connectionState) && '3D MAP STANDBY'}
            </span>
          </div>
        </div>
      )}

      {/* STALE indicator */}
      {isStale && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 glass-panel px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider pointer-events-none border border-amber text-amber animate-pulse">
          {connectionState === 'STALE' ? 'DATALINK STALE — LAST KNOWN POSITION' : 'WAITING FOR DRONE'}
        </div>
      )}

      {/* 3D HUD Coordinates & Terrain Status Badge */}
      <div className="absolute bottom-3 left-3 z-10 glass-panel px-3 py-1.5 text-[10px] font-mono pointer-events-none flex items-center gap-3">
        <div>
          <span className="text-text-faint">LAT </span>
          <span className="text-text font-bold">{((hasValidData && telemetry ? telemetry.lat : null) ?? DEFAULT_REF_LAT).toFixed(5)}°</span>
        </div>
        <div>
          <span className="text-text-faint">LON </span>
          <span className="text-text font-bold">{((hasValidData && telemetry ? telemetry.lon : null) ?? DEFAULT_REF_LON).toFixed(5)}°</span>
        </div>
        <div>
          <span className="text-text-faint">ALT </span>
          <span className="text-green font-bold">{(hasValidData ? alt : 0).toFixed(1)}m</span>
        </div>
        <div className="border-l border-border-lo pl-3 text-text-dim text-[9px] uppercase tracking-wider">
          3D TERRAIN + SATELLITE LABELS
        </div>
      </div>

      {/* Terrain mismatch indicator */}
      {terrainMismatch !== null && terrainMismatch > TERRAIN_MISMATCH_WARN && (
        <div
          className={`absolute top-2 left-1/2 -translate-x-1/2 z-10 glass-panel px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider pointer-events-none border ${
            terrainMismatch > TERRAIN_MISMATCH_SEVERE
              ? 'border-red text-red animate-pulse'
              : 'border-amber text-amber'
          }`}
        >
          ⚠ TERRAIN MODEL MISMATCH — {terrainMismatch.toFixed(1)}m divergence
        </div>
      )}
    </div>
  );
};
