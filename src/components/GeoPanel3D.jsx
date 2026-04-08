import { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Html,
  Line,
  GizmoHelper,
  GizmoViewcube,
  useGizmoContext,
} from "@react-three/drei";
import * as THREE from "three";
import {
  nodes as nodesGeo,
  pipes as pipesGeo,
  valves as valvesGeo,
  reservoirs as reservoirsGeo,
  overflow as overflowGeo,
} from "../data.js";
import NodePopup from "./popups/NodePopup.jsx";
import PipePopup from "./popups/PipePopup.jsx";
import ValvePopup from "./popups/ValvePopup.jsx";
import ReservoirPopup from "./popups/ReservoirPopup.jsx";
import OverflowPopup from "./popups/OverflowPopup.jsx";
import { fmtNum } from "../utils/fmt.js";
import "./SchematicPanel3D.css"; // reuse same CSS

/* ═══════════════════════════════════════════════════════════ */
/*  GEOGRAPHIC PROJECTION                                     */
/* ═══════════════════════════════════════════════════════════ */
const CENTER_LNG = -120.28534;
const CENTER_LAT = 37.80721;
const DEG_TO_RAD = Math.PI / 180;
const METERS_PER_DEG_LAT = 111195;
const METERS_PER_DEG_LNG =
  METERS_PER_DEG_LAT * Math.cos(CENTER_LAT * DEG_TO_RAD);
const SCALE = 189; // meters per Three.js unit → ~20 units across data width

/** Convert lng/lat to local Three.js XY (centered on data centroid). */
function projectGeo(lng, lat) {
  const x = ((lng - CENTER_LNG) * METERS_PER_DEG_LNG) / SCALE;
  const y = ((lat - CENTER_LAT) * METERS_PER_DEG_LAT) / SCALE;
  return [x, y];
}

/* ═══════════════════════════════════════════════════════════ */
/*  CONSTANTS                                                 */
/* ═══════════════════════════════════════════════════════════ */
const ELEV_MIN = 900;
const ELEV_MAX = 2250;
const Z_RANGE = 8;
const GEO_Z_BASE = 2; // lift elements above ground plane
const scaleZ = (val) =>
  GEO_Z_BASE + ((val - ELEV_MIN) / (ELEV_MAX - ELEV_MIN)) * Z_RANGE;

const ELEV_COLOR = "#95C13D";
const HEAD_COLOR = "#4A90D9";
const RESERVOIR_Z_BOOST = 0.5;
const RESERVOIR_THICKNESS = 0.6;
const OVERFLOW_SIDE = 0.6;
const OVERFLOW_DIAM_FT = 42;
const OVERFLOW_RADIUS = (OVERFLOW_DIAM_FT * 0.3048) / 2 / SCALE; // 42 ft diameter in scene units
const LERP_SPEED = 8;
const BASE_ZOOM = 35; // reference zoom for element sizing

const FACE_THRESHOLD = 0.02;
const ROTATE_DURATION = 0.3;
const VIEWCUBE_DURATION = 0.4;

/* Module-level animation state (prefixed to avoid conflict with SchematicPanel3D) */
let _geoRotatePending = null;
let _geoViewcubeNav = null;
let _geoRotateAnim = null;

/* ═══════════════════════════════════════════════════════════ */
/*  SATELLITE TILE MATH                                       */
/* ═══════════════════════════════════════════════════════════ */
function lngLatToTile(lng, lat, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = lat * DEG_TO_RAD;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

function tileToLng(tx, zoom) {
  return (tx / Math.pow(2, zoom)) * 360 - 180;
}

function tileToLat(ty, zoom) {
  const n = Math.PI - (2 * Math.PI * ty) / Math.pow(2, zoom);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/* ═══════════════════════════════════════════════════════════ */
/*  SATELLITE GROUND PLANE                                    */
/* ═══════════════════════════════════════════════════════════ */
function SatelliteGroundPlane({ visible, opacity }) {
  const [texture, setTexture] = useState(null);
  const [planeBounds, setPlaneBounds] = useState(null);
  const matRef = useRef();

  useEffect(() => {
    const ZOOM = 16;
    const TILE_SIZE = 256;
    const PAD = 0.004; // ~400m padding around data extent

    const minLng = -120.307 - PAD;
    const maxLng = -120.264 + PAD;
    const minLat = 37.8 - PAD;
    const maxLat = 37.814 + PAD;

    const tl = lngLatToTile(minLng, maxLat, ZOOM);
    const br = lngLatToTile(maxLng, minLat, ZOOM);

    const tilesX = br.x - tl.x + 1;
    const tilesY = br.y - tl.y + 1;

    const canvas = document.createElement("canvas");
    canvas.width = tilesX * TILE_SIZE;
    canvas.height = tilesY * TILE_SIZE;
    const ctx = canvas.getContext("2d");

    let loaded = 0;
    const total = tilesX * tilesY;

    for (let ty = tl.y; ty <= br.y; ty++) {
      for (let tx = tl.x; tx <= br.x; tx++) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        const px = (tx - tl.x) * TILE_SIZE;
        const py = (ty - tl.y) * TILE_SIZE;
        img.onload = () => {
          ctx.drawImage(img, px, py);
          loaded++;
          if (loaded === total) {
            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.colorSpace = THREE.SRGBColorSpace;
            setTexture(tex);
            // Geographic bounds of the tile grid
            const gBounds = {
              lngW: tileToLng(tl.x, ZOOM),
              lngE: tileToLng(br.x + 1, ZOOM),
              latN: tileToLat(tl.y, ZOOM),
              latS: tileToLat(br.y + 1, ZOOM),
            };
            const [x1, y1] = projectGeo(gBounds.lngW, gBounds.latS);
            const [x2, y2] = projectGeo(gBounds.lngE, gBounds.latN);
            setPlaneBounds({
              cx: (x1 + x2) / 2,
              cy: (y1 + y2) / 2,
              w: x2 - x1,
              h: y2 - y1,
            });
          }
        };
        img.onerror = () => {
          loaded++;
          if (loaded === total) {
            /* If all tiles fail, still set a placeholder so the component
               renders a dark ground plane instead of nothing */
            ctx.fillStyle = "#1a2633";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const tex = new THREE.CanvasTexture(canvas);
            setTexture(tex);
            const gBounds = {
              lngW: tileToLng(tl.x, ZOOM),
              lngE: tileToLng(br.x + 1, ZOOM),
              latN: tileToLat(tl.y, ZOOM),
              latS: tileToLat(br.y + 1, ZOOM),
            };
            const [x1, y1] = projectGeo(gBounds.lngW, gBounds.latS);
            const [x2, y2] = projectGeo(gBounds.lngE, gBounds.latN);
            setPlaneBounds({
              cx: (x1 + x2) / 2,
              cy: (y1 + y2) / 2,
              w: x2 - x1,
              h: y2 - y1,
            });
          }
        };
        // ESRI World Imagery — supports CORS (Google tiles do not)
        img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${ty}/${tx}`;
      }
    }

    return () => {
      if (texture) texture.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Animate opacity
  useFrame(() => {
    if (matRef.current) {
      const target = visible ? opacity : 0;
      const current = matRef.current.opacity;
      if (Math.abs(current - target) > 0.005) {
        matRef.current.opacity += (target - current) * 0.15;
        matRef.current.needsUpdate = true;
      }
    }
  });

  if (!texture || !planeBounds) return null;

  return (
    <mesh
      position={[planeBounds.cx, planeBounds.cy, -0.01]}
      rotation={[0, 0, 0]}
    >
      <planeGeometry args={[planeBounds.w, planeBounds.h]} />
      <meshBasicMaterial
        ref={matRef}
        map={texture}
        transparent
        opacity={visible ? opacity : 0}
        depthWrite={false}
      />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  ANIMATED DASHED PIPE                                      */
/* ═══════════════════════════════════════════════════════════ */
function AnimatedPipe({
  points,
  flow,
  flowSign,
  maxFlow,
  pipeSize,
  opacity,
  onClick,
  onPointerOver,
  onPointerOut,
  highlighted,
}) {
  const lineRef = useRef();
  const [hovered, setHovered] = useState(false);
  const isHL = hovered || highlighted;
  const absFlow = Math.abs(flow);
  const hasFlow = absFlow > 0.001;

  const lerpedPts = useRef(null);
  const targetPts = useRef(points);
  targetPts.current = points;

  // Use the precomputed flowSign (based on EPANET hydraulic head)
  // to animate dashes from higher head to lower head.
  const sign = flowSign || -1;

  const speed = hasFlow ? 0.3 + (absFlow / Math.max(maxFlow, 1)) * 2.0 : 0;
  const lineWidth = 1 + ((pipeSize - 48) / (120 - 48)) * 4;

  useFrame((_, dt) => {
    if (!lineRef.current) return;
    const target = targetPts.current;
    const n = target.length;
    if (!lerpedPts.current || lerpedPts.current.length !== n * 3) {
      lerpedPts.current = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        lerpedPts.current[i * 3] = target[i][0];
        lerpedPts.current[i * 3 + 1] = target[i][1];
        lerpedPts.current[i * 3 + 2] = target[i][2];
      }
    }
    const alpha = 1 - Math.exp(-LERP_SPEED * dt);
    const pts = lerpedPts.current;
    let posChanged = false;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 3; j++) {
        const idx = i * 3 + j;
        const diff = target[i][j] - pts[idx];
        if (Math.abs(diff) > 0.0005) {
          pts[idx] += diff * alpha;
          posChanged = true;
        }
      }
    }
    if (posChanged && lineRef.current.geometry) {
      lineRef.current.geometry.setPositions(pts);
      lineRef.current.computeLineDistances();
    }
    if (hasFlow) {
      const mat = lineRef.current.material;
      if (mat) mat.dashOffset += speed * sign * dt;
    }
  });

  const baseColor = hasFlow ? "#1f78b4" : "#999";
  const color = isHL ? "#ffff00" : baseColor;
  const width = isHL ? lineWidth + 2 : lineWidth;

  const handleOver = useCallback(
    (e) => {
      e.stopPropagation();
      setHovered(true);
      onPointerOver?.(e);
    },
    [onPointerOver],
  );
  const handleOut = useCallback(
    (e) => {
      setHovered(false);
      onPointerOut?.(e);
    },
    [onPointerOut],
  );

  return (
    <Line
      ref={lineRef}
      points={points}
      color={color}
      lineWidth={width}
      dashed={hasFlow}
      dashSize={0.3}
      gapSize={0.15}
      opacity={opacity}
      transparent={opacity < 1}
      onClick={onClick}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
    />
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  NODE SPHERE                                               */
/* ═══════════════════════════════════════════════════════════ */
function NodeSphere({
  position,
  color,
  radius,
  opacity,
  onClick,
  onPointerOver,
  onPointerOut,
  highlighted,
}) {
  const meshRef = useRef();
  const [hovered, setHovered] = useState(false);
  const isHL = hovered || highlighted;

  const currentPos = useRef(position.slice());
  const targetPos = useRef(position);
  targetPos.current = position;

  useFrame(({ camera }, dt) => {
    if (!meshRef.current) return;
    const alpha = 1 - Math.exp(-LERP_SPEED * dt);
    const c = currentPos.current;
    const t = targetPos.current;
    c[0] += (t[0] - c[0]) * alpha;
    c[1] += (t[1] - c[1]) * alpha;
    c[2] += (t[2] - c[2]) * alpha;
    meshRef.current.position.set(c[0], c[1], c[2]);
    // Scale inversely with zoom so spheres don't dominate when zoomed in
    const s = BASE_ZOOM / Math.max(camera.zoom, 1);
    meshRef.current.scale.setScalar(s);
  });

  const handleOver = useCallback(
    (e) => {
      e.stopPropagation();
      setHovered(true);
      onPointerOver?.(e);
    },
    [onPointerOver],
  );
  const handleOut = useCallback(
    (e) => {
      setHovered(false);
      onPointerOut?.(e);
    },
    [onPointerOut],
  );

  return (
    <mesh
      ref={meshRef}
      onClick={onClick}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
    >
      <sphereGeometry args={[isHL ? radius * 1.35 : radius, 16, 16]} />
      <meshStandardMaterial
        color={isHL ? "#ffff00" : color}
        opacity={opacity}
        transparent={opacity < 1}
        emissive={isHL ? "#ffff00" : "#000000"}
        emissiveIntensity={isHL ? 0.5 : 0}
      />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  RESERVOIR BOX  (still used for overflow small prisms)     */
/* ═══════════════════════════════════════════════════════════ */
function ReservoirBox({
  center,
  size,
  color,
  opacity,
  onClick,
  onPointerOver,
  onPointerOut,
  highlighted,
}) {
  const meshRef = useRef();
  const [hovered, setHovered] = useState(false);
  const isHL = hovered || highlighted;

  const currentCenter = useRef(center.slice());
  const targetCenter = useRef(center);
  targetCenter.current = center;

  useFrame((_, dt) => {
    if (!meshRef.current) return;
    const alpha = 1 - Math.exp(-LERP_SPEED * dt);
    const c = currentCenter.current;
    const t = targetCenter.current;
    c[0] += (t[0] - c[0]) * alpha;
    c[1] += (t[1] - c[1]) * alpha;
    c[2] += (t[2] - c[2]) * alpha;
    meshRef.current.position.set(c[0], c[1], c[2]);
  });

  const handleOver = useCallback(
    (e) => {
      e.stopPropagation();
      setHovered(true);
      onPointerOver?.(e);
    },
    [onPointerOver],
  );
  const handleOut = useCallback(
    (e) => {
      setHovered(false);
      onPointerOut?.(e);
    },
    [onPointerOut],
  );

  return (
    <mesh
      ref={meshRef}
      onClick={onClick}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
    >
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={isHL ? "#ffff00" : color}
        opacity={isHL ? Math.min(opacity * 0.5 + 0.3, 1) : opacity * 0.5}
        transparent
        emissive={isHL ? "#ffff00" : "#000000"}
        emissiveIntensity={isHL ? 0.4 : 0}
      />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  RESERVOIR POLYGON — actual geographic outline, extruded   */
/* ═══════════════════════════════════════════════════════════ */
function ReservoirPolygon({
  ring,
  zCenter,
  thickness,
  color,
  opacity,
  onClick,
  onPointerOver,
  onPointerOut,
  highlighted,
}) {
  const meshRef = useRef();
  const [hovered, setHovered] = useState(false);
  const isHL = hovered || highlighted;

  // Build extruded geometry from the projected polygon ring
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    // ring is array of [x, y] in projected coords
    shape.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) {
      shape.lineTo(ring[i][0], ring[i][1]);
    }
    shape.closePath();
    const extrudeSettings = {
      depth: thickness,
      bevelEnabled: false,
    };
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // ExtrudeGeometry extrudes along +Z from z=0 to z=depth.
    // We want to center the extrusion on z=0 so we can position via mesh.position.z.
    geo.translate(0, 0, -thickness / 2);
    return geo;
  }, [ring, thickness]);

  // Lerp z position
  const currentZ = useRef(zCenter);
  const targetZ = useRef(zCenter);
  targetZ.current = zCenter;

  useFrame((_, dt) => {
    if (!meshRef.current) return;
    const alpha = 1 - Math.exp(-LERP_SPEED * dt);
    currentZ.current += (targetZ.current - currentZ.current) * alpha;
    meshRef.current.position.z = currentZ.current;
  });

  const handleOver = useCallback(
    (e) => {
      e.stopPropagation();
      setHovered(true);
      onPointerOver?.(e);
    },
    [onPointerOver],
  );
  const handleOut = useCallback(
    (e) => {
      setHovered(false);
      onPointerOut?.(e);
    },
    [onPointerOut],
  );

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={[0, 0, zCenter]}
      onClick={onClick}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
    >
      <meshStandardMaterial
        color={isHL ? "#ffff00" : color}
        opacity={isHL ? Math.min(opacity * 0.5 + 0.3, 1) : opacity * 0.5}
        transparent
        emissive={isHL ? "#ffff00" : "#000000"}
        emissiveIntensity={isHL ? 0.4 : 0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  OVERFLOW CYLINDER — true-to-scale shaft                   */
/* ═══════════════════════════════════════════════════════════ */
function OverflowCylinder({
  cx,
  cy,
  zBottom,
  zTop,
  color,
  opacity,
  onClick,
  onPointerOver,
  onPointerOut,
  highlighted,
}) {
  const meshRef = useRef();
  const [hovered, setHovered] = useState(false);
  const isHL = hovered || highlighted;

  const height = Math.max(zTop - zBottom, 0.02); // ensure minimum visible height
  const zCenter = (zBottom + zTop) / 2;

  // Lerp Z center
  const currentZ = useRef(zCenter);
  const targetZ = useRef(zCenter);
  targetZ.current = zCenter;

  const currentH = useRef(height);
  const targetH = useRef(height);
  targetH.current = height;

  useFrame((_, dt) => {
    if (!meshRef.current) return;
    const alpha = 1 - Math.exp(-LERP_SPEED * dt);
    currentZ.current += (targetZ.current - currentZ.current) * alpha;
    currentH.current += (targetH.current - currentH.current) * alpha;
    meshRef.current.position.set(cx, cy, currentZ.current);
    meshRef.current.scale.y = currentH.current;
  });

  const handleOver = useCallback(
    (e) => {
      e.stopPropagation();
      setHovered(true);
      onPointerOver?.(e);
    },
    [onPointerOver],
  );
  const handleOut = useCallback(
    (e) => {
      setHovered(false);
      onPointerOut?.(e);
    },
    [onPointerOut],
  );

  return (
    <mesh
      ref={meshRef}
      position={[cx, cy, zCenter]}
      rotation={[Math.PI / 2, 0, 0]}
      scale={[1, height, 1]}
      onClick={onClick}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
    >
      {/* CylinderGeometry: radiusTop, radiusBottom, height=1 (scaled via scale.y), radialSegments */}
      <cylinderGeometry args={[OVERFLOW_RADIUS, OVERFLOW_RADIUS, 1, 32]} />
      <meshStandardMaterial
        color={isHL ? "#ffff00" : color}
        opacity={isHL ? Math.min(opacity * 0.5 + 0.3, 1) : opacity * 0.5}
        transparent
        emissive={isHL ? "#ffff00" : "#000000"}
        emissiveIntensity={isHL ? 0.4 : 0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  ANIMATED RISER LINE                                       */
/* ═══════════════════════════════════════════════════════════ */
function AnimatedRiser({ x, y, z1, z2, color, lineWidth, opacity }) {
  const lineRef = useRef();
  const currentZ = useRef([z1, z2]);
  const targetZ = useRef([z1, z2]);
  targetZ.current = [z1, z2];

  const points = useMemo(
    () => [
      [x, y, z1],
      [x, y, z2],
    ],
    [x, y, z1, z2],
  );

  useFrame((_, dt) => {
    if (!lineRef.current?.geometry) return;
    const alpha = 1 - Math.exp(-LERP_SPEED * dt);
    const c = currentZ.current;
    const t = targetZ.current;
    let changed = false;
    for (let i = 0; i < 2; i++) {
      const diff = t[i] - c[i];
      if (Math.abs(diff) > 0.0005) {
        c[i] += diff * alpha;
        changed = true;
      }
    }
    if (changed) {
      const flat = new Float32Array([x, y, c[0], x, y, c[1]]);
      lineRef.current.geometry.setPositions(flat);
    }
  });

  return (
    <Line
      ref={lineRef}
      points={points}
      color={color}
      lineWidth={lineWidth}
      opacity={opacity}
      transparent
    />
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  CAMERA AUTO-FIT                                           */
/* ═══════════════════════════════════════════════════════════ */
function CameraSetup() {
  const { camera } = useThree();
  useEffect(() => {
    camera.up.set(0, 0, 1); // Z is up
    camera.position.set(0, -20, 18);
    camera.lookAt(0, 0, 5);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

/* ═══════════════════════════════════════════════════════════ */
/*  POINTER CURSOR HELPER                                     */
/* ═══════════════════════════════════════════════════════════ */
function usePointerCursor() {
  const { gl } = useThree();
  const onOver = useCallback(() => {
    gl.domElement.style.cursor = "pointer";
  }, [gl]);
  const onOut = useCallback(() => {
    gl.domElement.style.cursor = "auto";
  }, [gl]);
  return { onOver, onOut };
}

/* ═══════════════════════════════════════════════════════════ */
/*  CUSTOM VIEWCUBE (intercepts top/bottom for clean nav)     */
/* ═══════════════════════════════════════════════════════════ */
function CustomViewcube(props) {
  const { tweenCamera } = useGizmoContext();

  const handleClick = useCallback(
    (e) => {
      e.stopPropagation();
      let direction;
      if (e.face && e.object.position.lengthSq() < 0.01) {
        direction = e.face.normal.clone();
      } else {
        direction = e.object.position.clone().normalize();
      }
      if (
        Math.abs(direction.z) > 0.9 &&
        Math.abs(direction.x) < 0.1 &&
        Math.abs(direction.y) < 0.1
      ) {
        _geoViewcubeNav = { direction: direction.clone() };
      } else {
        tweenCamera(direction);
      }
    },
    [tweenCamera],
  );

  return (
    <group scale={0.867}>
      <GizmoViewcube {...props} onClick={handleClick} />
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  Z-AXIS OVERLAY (gridlines + labels)                       */
/* ═══════════════════════════════════════════════════════════ */
const Z_AXIS_MAX_ELEV = 2400;
const Z_AXIS_TICKS = [];
{
  const minor = 50;
  const major = 100;
  for (
    let elev = Math.ceil(ELEV_MIN / minor) * minor;
    elev <= Z_AXIS_MAX_ELEV;
    elev += minor
  ) {
    Z_AXIS_TICKS.push({ elev, z: scaleZ(elev), major: elev % major === 0 });
  }
}

function ZAxisOverlay({ visible, controlsRef }) {
  const groupRef = useRef();
  const majorGeoRef = useRef();
  const minorGeoRef = useRef();
  const leftGroupRef = useRef();
  const rightGroupRef = useRef();
  const leftLabelRefs = useRef([]);
  const rightLabelRefs = useRef([]);
  const highlightGeoRef = useRef();
  const highlightMatRef = useRef();
  const currentOpacity = useRef(0);
  const hoveredIdxRef = useRef(-1);
  const [, forceUpdate] = useState(0);
  const { camera, invalidate } = useThree();
  const _d = useMemo(() => new THREE.Vector3(), []);
  const _r = useMemo(() => new THREE.Vector3(), []);
  const lastEndpoints = useRef({ lx: 0, ly: 0, rx: 0, ry: 0 });

  const majorTicks = useMemo(() => Z_AXIS_TICKS.filter((t) => t.major), []);
  const minorTicks = useMemo(() => Z_AXIS_TICKS.filter((t) => !t.major), []);

  const majorPositions = useMemo(
    () => new Float32Array(majorTicks.length * 6),
    [majorTicks],
  );
  const minorPositions = useMemo(
    () => new Float32Array(minorTicks.length * 6),
    [minorTicks],
  );
  const highlightPositions = useMemo(() => new Float32Array(6), []);

  const HALF_SPAN = 15;
  const LABEL_GAP = 3.0;

  const setHovered = useCallback(
    (idx) => {
      if (hoveredIdxRef.current === idx) return;
      hoveredIdxRef.current = idx;
      for (let i = 0; i < leftLabelRefs.current.length; i++) {
        const lEl = leftLabelRefs.current[i];
        const rEl = rightLabelRefs.current[i];
        const active = i === idx;
        if (lEl) {
          lEl.style.color = active ? "#0d47a1" : "#1f78b4";
          lEl.style.textShadow =
            active ? "0 0 6px rgba(13,71,161,0.4)" : "none";
          lEl.style.fontSize = active ? "15px" : "13px";
        }
        if (rEl) {
          rEl.style.color = active ? "#0d47a1" : "#1f78b4";
          rEl.style.textShadow =
            active ? "0 0 6px rgba(13,71,161,0.4)" : "none";
          rEl.style.fontSize = active ? "15px" : "13px";
        }
      }
      if (highlightGeoRef.current && highlightMatRef.current) {
        if (idx >= 0 && idx < majorTicks.length) {
          const z = majorTicks[idx].z;
          const { lx, ly, rx, ry } = lastEndpoints.current;
          const arr = highlightGeoRef.current.attributes.position.array;
          arr[0] = lx;
          arr[1] = ly;
          arr[2] = z;
          arr[3] = rx;
          arr[4] = ry;
          arr[5] = z;
          highlightGeoRef.current.attributes.position.needsUpdate = true;
          highlightMatRef.current.visible = true;
        } else {
          highlightMatRef.current.visible = false;
        }
      }
      invalidate();
    },
    [majorTicks, invalidate],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const targetOp = visible ? 1 : 0;
    const speed = 6;
    const alpha = 1 - Math.exp(-speed * dt);
    currentOpacity.current += (targetOp - currentOpacity.current) * alpha;
    if (Math.abs(currentOpacity.current - targetOp) < 0.005)
      currentOpacity.current = targetOp;
    const op = currentOpacity.current;
    if (!groupRef.current) return;
    groupRef.current.visible = op > 0.005;

    groupRef.current.traverse((child) => {
      if (child.material) {
        child.material.opacity = op * (child.userData.baseOpacity ?? 1);
        child.material.needsUpdate = true;
      }
    });

    for (const el of leftLabelRefs.current) {
      if (el) {
        el.style.opacity = op;
        el.style.visibility = op > 0.005 ? "visible" : "hidden";
      }
    }
    for (const el of rightLabelRefs.current) {
      if (el) {
        el.style.opacity = op;
        el.style.visibility = op > 0.005 ? "visible" : "hidden";
      }
    }

    if (highlightMatRef.current && hoveredIdxRef.current >= 0) {
      highlightMatRef.current.opacity = op * 0.7;
    }

    camera.getWorldDirection(_d);
    _d.z = 0;
    if (_d.lengthSq() < 0.001) return;
    _d.normalize();
    _r.set(-_d.y, _d.x, 0);

    const orbitTarget = controlsRef?.current?.target;
    const cx = orbitTarget?.x ?? 0;
    const cy = orbitTarget?.y ?? 0;

    const lx = cx - _r.x * HALF_SPAN;
    const ly = cy - _r.y * HALF_SPAN;
    const rx = cx + _r.x * HALF_SPAN;
    const ry = cy + _r.y * HALF_SPAN;
    lastEndpoints.current = { lx, ly, rx, ry };

    if (majorGeoRef.current) {
      const arr = majorGeoRef.current.attributes.position.array;
      for (let i = 0; i < majorTicks.length; i++) {
        const z = majorTicks[i].z;
        const j = i * 6;
        arr[j] = lx;
        arr[j + 1] = ly;
        arr[j + 2] = z;
        arr[j + 3] = rx;
        arr[j + 4] = ry;
        arr[j + 5] = z;
      }
      majorGeoRef.current.attributes.position.needsUpdate = true;
    }

    if (minorGeoRef.current) {
      const arr = minorGeoRef.current.attributes.position.array;
      for (let i = 0; i < minorTicks.length; i++) {
        const z = minorTicks[i].z;
        const j = i * 6;
        arr[j] = lx;
        arr[j + 1] = ly;
        arr[j + 2] = z;
        arr[j + 3] = rx;
        arr[j + 4] = ry;
        arr[j + 5] = z;
      }
      minorGeoRef.current.attributes.position.needsUpdate = true;
    }

    if (
      highlightGeoRef.current &&
      hoveredIdxRef.current >= 0 &&
      hoveredIdxRef.current < majorTicks.length
    ) {
      const z = majorTicks[hoveredIdxRef.current].z;
      const arr = highlightGeoRef.current.attributes.position.array;
      arr[0] = lx;
      arr[1] = ly;
      arr[2] = z;
      arr[3] = rx;
      arr[4] = ry;
      arr[5] = z;
      highlightGeoRef.current.attributes.position.needsUpdate = true;
    }

    const lgx = cx - _r.x * (HALF_SPAN + LABEL_GAP);
    const lgy = cy - _r.y * (HALF_SPAN + LABEL_GAP);
    const rgx = cx + _r.x * (HALF_SPAN + LABEL_GAP);
    const rgy = cy + _r.y * (HALF_SPAN + LABEL_GAP);
    if (leftGroupRef.current) leftGroupRef.current.position.set(lgx, lgy, 0);
    if (rightGroupRef.current) rightGroupRef.current.position.set(rgx, rgy, 0);
  });

  const labelStyle = {
    fontSize: 13,
    lineHeight: "13px",
    color: "#1f78b4",
    fontFamily: "system-ui, sans-serif",
    fontWeight: 700,
    whiteSpace: "nowrap",
    pointerEvents: "auto",
    userSelect: "none",
    opacity: 0,
    visibility: "hidden",
    cursor: "default",
    transition: "color 0.15s, font-size 0.15s, text-shadow 0.15s",
    padding: "4px 2px",
  };

  return (
    <group ref={groupRef} visible={false} renderOrder={-1}>
      <lineSegments>
        <bufferGeometry ref={majorGeoRef}>
          <bufferAttribute
            attach="attributes-position"
            array={majorPositions}
            count={majorTicks.length * 2}
            itemSize={3}
            usage={THREE.DynamicDrawUsage}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color="#94a3b8"
          transparent
          depthWrite={false}
          userData={{ baseOpacity: 0.4 }}
        />
      </lineSegments>

      <lineSegments>
        <bufferGeometry ref={minorGeoRef}>
          <bufferAttribute
            attach="attributes-position"
            array={minorPositions}
            count={minorTicks.length * 2}
            itemSize={3}
            usage={THREE.DynamicDrawUsage}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color="#cbd5e1"
          transparent
          depthWrite={false}
          userData={{ baseOpacity: 0.2 }}
        />
      </lineSegments>

      <line>
        <bufferGeometry ref={highlightGeoRef}>
          <bufferAttribute
            attach="attributes-position"
            array={highlightPositions}
            count={2}
            itemSize={3}
            usage={THREE.DynamicDrawUsage}
          />
        </bufferGeometry>
        <lineBasicMaterial
          ref={highlightMatRef}
          color="#0d47a1"
          transparent
          depthWrite={false}
          visible={false}
          userData={{ baseOpacity: 0.7 }}
        />
      </line>

      <group ref={leftGroupRef}>
        {majorTicks.map(({ elev, z }, idx) => (
          <Html key={`l-${elev}`} position={[0, 0, z]} zIndexRange={[0, 0]}>
            <span
              ref={(el) => {
                leftLabelRefs.current[idx] = el;
              }}
              style={{
                ...labelStyle,
                position: "absolute",
                right: 0,
                top: "50%",
                transform: "translateY(-50%)",
                paddingRight: 4,
              }}
              onMouseEnter={() => setHovered(idx)}
              onMouseLeave={() => setHovered(-1)}
            >
              {`${elev.toLocaleString()} FT`}
            </span>
          </Html>
        ))}
      </group>

      <group ref={rightGroupRef}>
        {majorTicks.map(({ elev, z }, idx) => (
          <Html key={`r-${elev}`} position={[0, 0, z]} zIndexRange={[0, 0]}>
            <span
              ref={(el) => {
                rightLabelRefs.current[idx] = el;
              }}
              style={{
                ...labelStyle,
                position: "absolute",
                left: 0,
                top: "50%",
                transform: "translateY(-50%)",
                paddingLeft: 4,
              }}
              onMouseEnter={() => setHovered(idx)}
              onMouseLeave={() => setHovered(-1)}
            >
              {`${elev.toLocaleString()} FT`}
            </span>
          </Html>
        ))}
      </group>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  FACE-ON DETECTOR + ROTATOR                                */
/* ═══════════════════════════════════════════════════════════ */
const _faceDir = new THREE.Vector3();

function FaceOnDetector({ controlsRef, onFaceOnChange, onSideFaceOnChange }) {
  const { camera, invalidate } = useThree();
  const wasFaceOn = useRef(false);
  const wasSideFaceOn = useRef(false);

  useFrame((_, delta) => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;

    // Viewcube navigation (top/bottom)
    if (_geoViewcubeNav) {
      const { direction } = _geoViewcubeNav;
      _geoViewcubeNav = null;
      const target = controls.target;
      const radius = camera.position.distanceTo(target);
      const endPos = direction.clone().multiplyScalar(radius).add(target);
      const endUp = new THREE.Vector3(0, 1, 0);
      const startQ = camera.quaternion.clone();
      const tempCam = camera.clone();
      tempCam.up.copy(endUp);
      tempCam.position.copy(endPos);
      tempCam.lookAt(target);
      tempCam.updateMatrixWorld(true);
      const endQ = tempCam.quaternion.clone();
      _geoRotateAnim = {
        startPos: camera.position.clone(),
        endPos,
        startUp: camera.up.clone(),
        endUp,
        startQ,
        endQ,
        t: 0,
        duration: VIEWCUBE_DURATION,
      };
    }

    // Start a new animated rotation if pending
    if (_geoRotatePending) {
      const { angle: angleDeg } = _geoRotatePending;
      _geoRotatePending = null;
      const target = controls.target;
      const dir = new THREE.Vector3()
        .subVectors(target, camera.position)
        .normalize();
      const angle = THREE.MathUtils.degToRad(angleDeg);
      const q = new THREE.Quaternion().setFromAxisAngle(dir, angle);
      const targetUp = camera.up.clone().applyQuaternion(q).normalize();
      const ux = Math.abs(targetUp.x),
        uy = Math.abs(targetUp.y),
        uz = Math.abs(targetUp.z);
      if (ux >= uy && ux >= uz) targetUp.set(Math.sign(targetUp.x), 0, 0);
      else if (uy >= ux && uy >= uz) targetUp.set(0, Math.sign(targetUp.y), 0);
      else targetUp.set(0, 0, Math.sign(targetUp.z));
      const offset = new THREE.Vector3().subVectors(camera.position, target);
      const targetOffset = offset.clone().applyQuaternion(q);
      const startQ = camera.quaternion.clone();
      const endPos = target.clone().add(targetOffset);
      const tempCam = camera.clone();
      tempCam.up.copy(targetUp);
      tempCam.position.copy(endPos);
      tempCam.lookAt(target);
      tempCam.updateMatrixWorld(true);
      const endQ = tempCam.quaternion.clone();
      _geoRotateAnim = {
        startPos: camera.position.clone(),
        endPos,
        startUp: camera.up.clone(),
        endUp: targetUp,
        startQ,
        endQ,
        t: 0,
        duration: ROTATE_DURATION,
      };
    }

    // Animate rotation in progress
    if (_geoRotateAnim) {
      _geoRotateAnim.t += delta;
      const raw = Math.min(_geoRotateAnim.t / _geoRotateAnim.duration, 1);
      const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
      camera.position.lerpVectors(
        _geoRotateAnim.startPos,
        _geoRotateAnim.endPos,
        t,
      );
      camera.up
        .lerpVectors(_geoRotateAnim.startUp, _geoRotateAnim.endUp, t)
        .normalize();
      camera.quaternion.slerpQuaternions(
        _geoRotateAnim.startQ,
        _geoRotateAnim.endQ,
        t,
      );
      camera.updateMatrixWorld(true);
      controls.update();
      invalidate();
      if (raw >= 1) {
        camera.position.copy(_geoRotateAnim.endPos);
        camera.up.copy(_geoRotateAnim.endUp);
        camera.lookAt(controls.target);
        camera.updateMatrixWorld(true);
        controls.update();
        _geoRotateAnim = null;
      }
    }

    // Fix degenerate camera.up when looking along Z-axis
    _faceDir.subVectors(controls.target, camera.position).normalize();
    const upDotView = Math.abs(camera.up.dot(_faceDir));
    if (upDotView > 0.99) {
      camera.up.set(0, 1, 0);
      controls.update();
      invalidate();
    }

    // Detect face-on
    const ax = Math.abs(_faceDir.x),
      ay = Math.abs(_faceDir.y),
      az = Math.abs(_faceDir.z);
    const isFaceOn =
      (ax > 1 - FACE_THRESHOLD && ay < FACE_THRESHOLD && az < FACE_THRESHOLD) ||
      (ay > 1 - FACE_THRESHOLD && ax < FACE_THRESHOLD && az < FACE_THRESHOLD) ||
      (az > 1 - FACE_THRESHOLD && ax < FACE_THRESHOLD && ay < FACE_THRESHOLD);

    if (isFaceOn !== wasFaceOn.current) {
      wasFaceOn.current = isFaceOn;
      onFaceOnChange(isFaceOn);
    }

    const isSideFaceOn = az < FACE_THRESHOLD;
    if (isSideFaceOn !== wasSideFaceOn.current) {
      wasSideFaceOn.current = isSideFaceOn;
      onSideFaceOnChange(isSideFaceOn);
    }
  });

  return null;
}

/* ═══════════════════════════════════════════════════════════ */
/*  SCENE CONTENT — renders inside <Canvas>                   */
/* ═══════════════════════════════════════════════════════════ */
function GeoSceneContent({
  hydraulicResults: r,
  valveOverrides,
  onValveOverrideChange,
  elevOverrides,
  onElevOverrideChange,
  elevOpacity,
  headOpacity,
  layerVis,
  onFaceOnChange,
  onSideFaceOnChange,
  isSideFaceOn,
  popup,
  setPopup,
}) {
  const [hoveredElement, setHoveredElement] = useState(null);
  const { camera, gl } = useThree();
  const hoverIn = useCallback(
    (id) => {
      setHoveredElement(id);
      gl.domElement.style.cursor = "pointer";
    },
    [gl],
  );
  const hoverOut = useCallback(() => {
    setHoveredElement(null);
    gl.domElement.style.cursor = "auto";
  }, [gl]);
  const controlsRef = useRef(null);

  // Max flow for animation speed scaling
  const maxFlow = useMemo(() => {
    if (!r?.pipes) return 1;
    let m = 1;
    for (const p of Object.values(r.pipes)) {
      const af = Math.abs(p.flow || 0);
      if (af > m) m = af;
    }
    return m;
  }, [r]);

  // Helper: get head/elev for a node-like element
  const getNodeHead = useCallback(
    (name) => r?.nodes?.[name]?.head ?? null,
    [r],
  );
  const getNodeElev = useCallback(
    (name, fallbackElev) => {
      const ov = elevOverrides?.[name];
      if (ov != null) return ov;
      return fallbackElev;
    },
    [elevOverrides],
  );

  /* ── Build element arrays using geographic data ── */
  const nodeElements = useMemo(() => {
    return nodesGeo.features.map((f) => {
      const name = f.properties.name;
      const [lng, lat] = f.geometry.coordinates;
      const [x, y] = projectGeo(lng, lat);
      const elev = getNodeElev(name, f.properties.elev);
      const head = getNodeHead(name);
      return { name, x, y, elev, head, properties: f.properties };
    });
  }, [getNodeElev, getNodeHead]);

  const valveElements = useMemo(() => {
    return valvesGeo.features.map((f) => {
      const name = f.properties.name;
      const [lng, lat] = f.geometry.coordinates;
      const [x, y] = projectGeo(lng, lat);
      const elev = f.properties.elev;
      const vRes = r?.valves?.[name];
      const head = vRes ? (vRes.us_head + vRes.ds_head) / 2 : null;
      return { name, x, y, elev, head, properties: f.properties, vRes };
    });
  }, [r]);

  const reservoirElements = useMemo(() => {
    return reservoirsGeo.features.map((f) => {
      const name = f.properties.name;
      const resElev = f.properties.elev;
      const elev = getNodeElev(name, resElev);
      const head = getNodeHead(name);

      // Extract geographic polygon ring and project to local XY
      const rawRing =
        f.geometry.type === "MultiPolygon" ?
          f.geometry.coordinates[0][0]
        : f.geometry.coordinates[0];

      // Project all vertices to local XY
      const projectedRing = rawRing.map(([lng, lat]) => projectGeo(lng, lat));

      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const [x, y] of projectedRing) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const ctrX = (minX + maxX) / 2,
        ctrY = (minY + maxY) / 2;

      return {
        name,
        elev,
        head,
        cx: ctrX,
        cy: ctrY,
        ring: projectedRing,
        oMinX: minX - 0.3,
        oMaxX: maxX + 0.3,
        oMinY: minY - 0.3,
        oMaxY: maxY + 0.3,
        properties: f.properties,
      };
    });
  }, [getNodeElev, getNodeHead]);

  const overflowElements = useMemo(() => {
    return overflowGeo.features.map((f) => {
      const name = f.properties.name;
      const weirCrestElev = getNodeElev(name, f.properties.elev); // overflow polygon elev = weir crest
      const head = getNodeHead(name);
      const isActive = r?.overflow?.[name]?.active;

      // The overflow junction node has the shaft bottom elevation
      const ovNode = nodesGeo.features.find(
        (nf) => nf.properties.name === name,
      );
      const nodeElev = ovNode ? ovNode.properties.elev : weirCrestElev;
      let ovX = 0,
        ovY = 0;
      if (ovNode) {
        const [lng, lat] = ovNode.geometry.coordinates;
        [ovX, ovY] = projectGeo(lng, lat);
      }

      // Find nearest reservoir
      let nearestRes = null;
      let nearestDist = Infinity;
      for (const res of reservoirElements) {
        const d = Math.hypot(ovX - res.cx, ovY - res.cy);
        if (d < nearestDist) {
          nearestDist = d;
          nearestRes = res;
        }
      }

      return {
        name,
        nodeElev, // bottom of shaft (junction elevation)
        weirCrestElev, // top of shaft (weir crest elevation)
        head,
        cx: ovX,
        cy: ovY,
        parentRes: nearestRes,
        isActive,
        properties: f.properties,
      };
    });
  }, [getNodeElev, getNodeHead, r, reservoirElements]);

  // Valve head/elev Z lookup for pipe endpoint snapping
  const valveHeadZByXY = useMemo(() => {
    const map = new Map();
    for (const v of valveElements) {
      if (v.head != null) {
        const key = `${v.x.toFixed(4)},${v.y.toFixed(4)}`;
        map.set(key, scaleZ(v.head));
      }
    }
    return map;
  }, [valveElements]);

  const valveElevZByXY = useMemo(() => {
    const map = new Map();
    for (const v of valveElements) {
      const key = `${v.x.toFixed(4)},${v.y.toFixed(4)}`;
      map.set(key, scaleZ(v.elev));
    }
    return map;
  }, [valveElements]);

  // Build name→[x,y] lookup for pipe endpoint matching (projected coords).
  // Used to determine whether a pipe's GeoJSON coordinates run us→ds or ds→us.
  const nodeCoordMap3D = useMemo(() => {
    const m = new Map();
    for (const fc of [nodesGeo, valvesGeo]) {
      if (!fc?.features) continue;
      for (const f of fc.features) {
        const name = f.properties?.name;
        const c = f.geometry?.coordinates;
        if (name && c) {
          const [x, y] = projectGeo(c[0], c[1]);
          m.set(name, [x, y]);
        }
      }
    }
    for (const fc of [reservoirsGeo, overflowGeo]) {
      if (!fc?.features) continue;
      for (const f of fc.features) {
        const name = f.properties?.name;
        const c = f.geometry?.coordinates;
        if (!name || !c) continue;
        const ring = c?.[0]?.[0] || c?.[0];
        if (!ring?.length) continue;
        const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
        const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        const [px, py] = projectGeo(cx, cy);
        m.set(name, [px, py]);
      }
    }
    return m;
  }, []);

  const pipeElements = useMemo(() => {
    return pipesGeo.features.map((f) => {
      const name = f.properties.name;
      const pRes = r?.pipes?.[name];
      const flow = pRes?.flow || 0;
      const usElev = pRes?.us_elev ?? 0;
      const dsElev = pRes?.ds_elev ?? 0;
      const usHead = pRes?.us_head ?? 0;
      const dsHead = pRes?.ds_head ?? 0;

      // Build 3D points from geographic line
      const rawCoords =
        f.geometry.type === "MultiLineString" ?
          f.geometry.coordinates[0]
        : f.geometry.coordinates;

      const coords = rawCoords.map(([lng, lat]) => projectGeo(lng, lat));
      const n = coords.length;

      const elevPoints = coords.map(([x, y], i) => {
        const t = n > 1 ? i / (n - 1) : 0;
        let z = scaleZ(usElev + (dsElev - usElev) * t);
        if (i === 0 || i === n - 1) {
          const key = `${x.toFixed(4)},${y.toFixed(4)}`;
          const vz = valveElevZByXY.get(key);
          if (vz != null) z = vz;
        }
        return [x, y, z];
      });
      const headPoints = coords.map(([x, y], i) => {
        const t = n > 1 ? i / (n - 1) : 0;
        let z = scaleZ(usHead + (dsHead - usHead) * t);
        if (i === 0 || i === n - 1) {
          const key = `${x.toFixed(4)},${y.toFixed(4)}`;
          const vz = valveHeadZByXY.get(key);
          if (vz != null) z = vz;
        }
        return [x, y, z];
      });
      // Determine animation direction from EPANET flow sign.
      // flow > 0 → water travels us_node → ds_node.
      // Check whether the GeoJSON first coordinate is at us_node or ds_node
      // then set flowSign so dashes travel from higher head to lower head.
      const usNode = f.properties.us_node;
      const dsNode = f.properties.ds_node;
      const usCoord = nodeCoordMap3D.get(usNode);
      const dsCoord = nodeCoordMap3D.get(dsNode);
      const firstXY = coords[0];
      const lastXY = coords[coords.length - 1];

      // Determine whether coords run us→ds or ds→us.
      // Compare both endpoints to handle short pipes near large
      // polygons (reservoir centroids far from pipe ends) and
      // missing node coordinates.
      let coordsGoUsToDs = true;
      if (firstXY && lastXY && usCoord && dsCoord) {
        const sumNormal =
          Math.hypot(firstXY[0] - usCoord[0], firstXY[1] - usCoord[1]) +
          Math.hypot(lastXY[0] - dsCoord[0], lastXY[1] - dsCoord[1]);
        const sumFlipped =
          Math.hypot(firstXY[0] - dsCoord[0], firstXY[1] - dsCoord[1]) +
          Math.hypot(lastXY[0] - usCoord[0], lastXY[1] - usCoord[1]);
        coordsGoUsToDs = sumNormal <= sumFlipped;
      } else if (firstXY && lastXY && usCoord) {
        coordsGoUsToDs =
          Math.hypot(firstXY[0] - usCoord[0], firstXY[1] - usCoord[1]) <=
          Math.hypot(lastXY[0] - usCoord[0], lastXY[1] - usCoord[1]);
      } else if (firstXY && lastXY && dsCoord) {
        coordsGoUsToDs =
          Math.hypot(lastXY[0] - dsCoord[0], lastXY[1] - dsCoord[1]) <=
          Math.hypot(firstXY[0] - dsCoord[0], firstXY[1] - dsCoord[1]);
      }
      // flowSign: -1 = dashes move first→last, +1 = dashes move last→first
      const flowGoesUsToDs = flow > 0;
      const flowSign = flowGoesUsToDs === coordsGoUsToDs ? -1 : 1;

      return {
        name,
        flow,
        flowSign,
        size: f.properties.size || 48,
        elevPoints,
        headPoints,
        properties: f.properties,
      };
    });
  }, [r, valveHeadZByXY, valveElevZByXY, nodeCoordMap3D]);

  // Vertical risers: pipe endpoints / valves under reservoirs → reservoir bottom
  const reservoirRisers = useMemo(() => {
    const risers = { elev: [], head: [] };
    for (const res of reservoirElements) {
      const elevBotZ =
        scaleZ(res.elev) + RESERVOIR_Z_BOOST - RESERVOIR_THICKNESS / 2;
      const headBotZ =
        res.head != null ?
          scaleZ(res.head) + RESERVOIR_Z_BOOST - RESERVOIR_THICKNESS / 2
        : null;

      const isInside = (x, y) =>
        x >= res.oMinX && x <= res.oMaxX && y >= res.oMinY && y <= res.oMaxY;

      for (const v of valveElements) {
        if (isInside(v.x, v.y)) {
          const vElevZ = scaleZ(v.elev);
          if (vElevZ < elevBotZ) {
            risers.elev.push({
              key: `riser-elev-v-${v.name}-${res.name}`,
              x: v.x,
              y: v.y,
              z1: vElevZ,
              z2: elevBotZ,
            });
          }
          if (v.head != null && headBotZ != null) {
            const vHeadZ = scaleZ(v.head);
            if (vHeadZ < headBotZ) {
              risers.head.push({
                key: `riser-head-v-${v.name}-${res.name}`,
                x: v.x,
                y: v.y,
                z1: vHeadZ,
                z2: headBotZ,
              });
            }
          }
        }
      }

      for (const p of pipeElements) {
        for (const overlay of ["elev", "head"]) {
          const pts = overlay === "elev" ? p.elevPoints : p.headPoints;
          const botZ = overlay === "elev" ? elevBotZ : headBotZ;
          if (botZ == null) continue;
          for (const endIdx of [0, pts.length - 1]) {
            const [px, py, pz] = pts[endIdx];
            if (isInside(px, py) && pz < botZ) {
              risers[overlay].push({
                key: `riser-${overlay}-p-${p.name}-${endIdx}-${res.name}`,
                x: px,
                y: py,
                z1: pz,
                z2: botZ,
              });
            }
          }
        }
      }
    }
    return risers;
  }, [reservoirElements, valveElements, pipeElements]);

  // Drop lines: from each node/valve elevation position down to Z=0 (ground plane)
  const dropLines = useMemo(() => {
    const lines = [];
    for (const n of nodeElements) {
      lines.push({
        key: `drop-n-${n.name}`,
        x: n.x,
        y: n.y,
        zElev: scaleZ(n.elev),
        zHead: n.head != null ? scaleZ(n.head) : null,
      });
    }
    for (const v of valveElements) {
      lines.push({
        key: `drop-v-${v.name}`,
        x: v.x,
        y: v.y,
        zElev: scaleZ(v.elev),
        zHead: v.head != null ? scaleZ(v.head) : null,
      });
    }
    // Reservoir perimeter — sample every Nth vertex for drop lines
    for (const res of reservoirElements) {
      const zElev =
        scaleZ(res.elev) + RESERVOIR_Z_BOOST - RESERVOIR_THICKNESS / 2;
      const zHead =
        res.head != null ?
          scaleZ(res.head) + RESERVOIR_Z_BOOST - RESERVOIR_THICKNESS / 2
        : null;
      const ring = res.ring;
      const step = Math.max(1, Math.floor(ring.length / 12)); // ~12 drop lines per reservoir
      for (let i = 0; i < ring.length; i += step) {
        lines.push({
          key: `drop-r-${res.name}-${i}`,
          x: ring[i][0],
          y: ring[i][1],
          zElev,
          zHead,
        });
      }
    }
    return lines;
  }, [nodeElements, valveElements, reservoirElements]);

  // Overlay connecting risers: faint lines between elevation and head positions
  // for each node/valve (only when both overlays are visible)
  const overlayConnectors = useMemo(() => {
    const lines = [];
    for (const n of nodeElements) {
      if (n.head == null) continue;
      const zElev = scaleZ(n.elev);
      const zHead = scaleZ(n.head);
      if (Math.abs(zHead - zElev) > 0.05) {
        lines.push({
          key: `conn-n-${n.name}`,
          x: n.x,
          y: n.y,
          z1: zElev,
          z2: zHead,
        });
      }
    }
    for (const v of valveElements) {
      if (v.head == null) continue;
      const zElev = scaleZ(v.elev);
      const zHead = scaleZ(v.head);
      if (Math.abs(zHead - zElev) > 0.05) {
        lines.push({
          key: `conn-v-${v.name}`,
          x: v.x,
          y: v.y,
          z1: zElev,
          z2: zHead,
        });
      }
    }
    return lines;
  }, [nodeElements, valveElements]);

  /* ── Click helpers ── */
  const openPopup = (type, name, properties) => (e) => {
    e.stopPropagation();
    setPopup({ type, name, properties });
  };

  /* ── Valve color logic (matches 2D) ── */
  const valveColor = useCallback(
    (v) => {
      const ov = valveOverrides?.[v.name];
      if (v.properties.type === "butterfly") {
        let mode = ov?.mode;
        if (!mode) {
          const isOpen =
            ov?.status === "open" ||
            (!ov?.status && String(v.properties.status) === "1");
          mode =
            !isOpen ? "closed"
            : (ov?.setting ?? 0) !== 0 ? "throttled"
            : "open";
        }
        if (mode === "throttled") return "#e6a817";
        if (mode === "closed") return "#c0392b";
        return "#1f78b4";
      }
      const isOpen =
        ov?.status === "open" ||
        (!ov?.status && String(v.properties.status) === "1");
      return isOpen ? "#1f78b4" : "#c0392b";
    },
    [valveOverrides],
  );

  return (
    <>
      <CameraSetup />
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, -10, 15]} intensity={0.8} />
      <directionalLight position={[-5, 10, 10]} intensity={0.3} />

      {/* Satellite basemap at Z=0 */}
      <SatelliteGroundPlane visible={layerVis.basemap} opacity={0.85} />

      <ZAxisOverlay visible={isSideFaceOn} controlsRef={controlsRef} />

      {/* ═══ DROP LINES — elements to ground plane ═══ */}
      {(elevOpacity > 0 || headOpacity > 0) &&
        dropLines.map((dl) => {
          // Use the tallest visible overlay as the top of the drop line
          let z2 = 0;
          if (elevOpacity > 0 && headOpacity > 0) {
            z2 = Math.max(dl.zElev, dl.zHead ?? dl.zElev);
          } else if (headOpacity > 0 && dl.zHead != null) {
            z2 = dl.zHead;
          } else {
            z2 = dl.zElev;
          }
          const opacity = Math.max(elevOpacity, headOpacity) * 0.2;
          return (
            <AnimatedRiser
              key={dl.key}
              x={dl.x}
              y={dl.y}
              z1={0}
              z2={z2}
              color="#94a3b8"
              lineWidth={1}
              opacity={opacity}
            />
          );
        })}

      {/* ═══ OVERLAY CONNECTORS — elev ↔ head ═══ */}
      {elevOpacity > 0 &&
        headOpacity > 0 &&
        overlayConnectors.map((c) => (
          <AnimatedRiser
            key={c.key}
            x={c.x}
            y={c.y}
            z1={c.z1}
            z2={c.z2}
            color="#94a3b8"
            lineWidth={1}
            opacity={Math.min(elevOpacity, headOpacity) * 0.35}
          />
        ))}

      {/* ═══ ELEVATION OVERLAY ═══ */}
      {elevOpacity > 0 && (
        <group>
          {/* Nodes */}
          {layerVis.nodes &&
            nodeElements.map((n) => (
              <NodeSphere
                key={`elev-n-${n.name}`}
                position={[n.x, n.y, scaleZ(n.elev)]}
                color="#333"
                radius={0.15}
                opacity={elevOpacity}
                onClick={openPopup("node", n.name, n.properties)}
                onPointerOver={() => hoverIn("n:" + n.name)}
                onPointerOut={hoverOut}
                highlighted={hoveredElement === "n:" + n.name}
              />
            ))}

          {/* Valves */}
          {layerVis.valves &&
            valveElements.map((v) => (
              <NodeSphere
                key={`elev-v-${v.name}`}
                position={[v.x, v.y, scaleZ(v.elev)]}
                color={valveColor(v)}
                radius={0.2}
                opacity={elevOpacity}
                onClick={openPopup("valve", v.name, v.properties)}
                onPointerOver={() => hoverIn("v:" + v.name)}
                onPointerOut={hoverOut}
                highlighted={hoveredElement === "v:" + v.name}
              />
            ))}

          {/* Reservoirs */}
          {layerVis.reservoirs &&
            reservoirElements.map((res) => {
              const z = scaleZ(res.elev) + RESERVOIR_Z_BOOST;
              return (
                <ReservoirPolygon
                  key={`elev-r-${res.name}`}
                  ring={res.ring}
                  zCenter={z}
                  thickness={RESERVOIR_THICKNESS}
                  color="#a6cde3"
                  opacity={elevOpacity}
                  onClick={openPopup("reservoir", res.name, res.properties)}
                  onPointerOver={() => hoverIn("r:" + res.name)}
                  onPointerOut={hoverOut}
                  highlighted={hoveredElement === "r:" + res.name}
                />
              );
            })}

          {/* Overflow */}
          {layerVis.overflow &&
            overflowElements.map((ov) => {
              const zBottom = scaleZ(ov.nodeElev);
              const zTop = scaleZ(ov.weirCrestElev);
              return (
                <OverflowCylinder
                  key={`elev-o-${ov.name}`}
                  cx={ov.cx}
                  cy={ov.cy}
                  zBottom={zBottom}
                  zTop={zTop}
                  color={ov.isActive ? "#e74c3c" : "#a6cde3"}
                  opacity={elevOpacity}
                  onClick={openPopup("overflow", ov.name, ov.properties)}
                  onPointerOver={() => hoverIn("o:" + ov.name)}
                  onPointerOut={hoverOut}
                  highlighted={hoveredElement === "o:" + ov.name}
                />
              );
            })}

          {/* Pipes */}
          {layerVis.pipes &&
            pipeElements.map((p) => (
              <AnimatedPipe
                key={`elev-p-${p.name}`}
                points={p.elevPoints}
                flow={p.flow}
                flowSign={p.flowSign}
                maxFlow={maxFlow}
                pipeSize={p.size}
                opacity={elevOpacity}
                onClick={openPopup("pipe", p.name, p.properties)}
                onPointerOver={() => hoverIn("p:" + p.name)}
                onPointerOut={hoverOut}
                highlighted={hoveredElement === "p:" + p.name}
              />
            ))}

          {/* Reservoir risers */}
          {layerVis.reservoirs &&
            reservoirRisers.elev.map((ri) => (
              <AnimatedRiser
                key={ri.key}
                x={ri.x}
                y={ri.y}
                z1={ri.z1}
                z2={ri.z2}
                color="#1f78b4"
                lineWidth={2}
                opacity={elevOpacity * 0.7}
              />
            ))}
        </group>
      )}

      {/* ═══ HEAD OVERLAY ═══ */}
      {headOpacity > 0 && (
        <group>
          {/* Nodes */}
          {layerVis.nodes &&
            nodeElements
              .filter((n) => n.head != null)
              .map((n) => (
                <NodeSphere
                  key={`head-n-${n.name}`}
                  position={[n.x, n.y, scaleZ(n.head)]}
                  color="#333"
                  radius={0.15}
                  opacity={headOpacity}
                  onClick={openPopup("node", n.name, n.properties)}
                  onPointerOver={() => hoverIn("n:" + n.name)}
                  onPointerOut={hoverOut}
                  highlighted={hoveredElement === "n:" + n.name}
                />
              ))}

          {/* Valves */}
          {layerVis.valves &&
            valveElements
              .filter((v) => v.head != null)
              .map((v) => (
                <NodeSphere
                  key={`head-v-${v.name}`}
                  position={[v.x, v.y, scaleZ(v.head)]}
                  color={valveColor(v)}
                  radius={0.2}
                  opacity={headOpacity}
                  onClick={openPopup("valve", v.name, v.properties)}
                  onPointerOver={() => hoverIn("v:" + v.name)}
                  onPointerOut={hoverOut}
                  highlighted={hoveredElement === "v:" + v.name}
                />
              ))}

          {/* Reservoirs */}
          {layerVis.reservoirs &&
            reservoirElements
              .filter((res) => res.head != null)
              .map((res) => {
                const z = scaleZ(res.head) + RESERVOIR_Z_BOOST;
                return (
                  <ReservoirPolygon
                    key={`head-r-${res.name}`}
                    ring={res.ring}
                    zCenter={z}
                    thickness={RESERVOIR_THICKNESS}
                    color={HEAD_COLOR}
                    opacity={headOpacity}
                    onClick={openPopup("reservoir", res.name, res.properties)}
                    onPointerOver={() => hoverIn("r:" + res.name)}
                    onPointerOut={hoverOut}
                    highlighted={hoveredElement === "r:" + res.name}
                  />
                );
              })}

          {/* Overflow */}
          {layerVis.overflow &&
            overflowElements
              .filter((ov) => ov.head != null)
              .map((ov) => {
                // For head overlay, use head as the top of the cylinder
                const zBottom = scaleZ(ov.nodeElev);
                const zTop = scaleZ(ov.head);
                return (
                  <OverflowCylinder
                    key={`head-o-${ov.name}`}
                    cx={ov.cx}
                    cy={ov.cy}
                    zBottom={zBottom}
                    zTop={zTop}
                    color={ov.isActive ? "#e74c3c" : HEAD_COLOR}
                    opacity={headOpacity}
                    onClick={openPopup("overflow", ov.name, ov.properties)}
                    onPointerOver={() => hoverIn("o:" + ov.name)}
                    onPointerOut={hoverOut}
                    highlighted={hoveredElement === "o:" + ov.name}
                  />
                );
              })}

          {/* Pipes */}
          {layerVis.pipes &&
            pipeElements.map((p) => (
              <AnimatedPipe
                key={`head-p-${p.name}`}
                points={p.headPoints}
                flow={p.flow}
                flowSign={p.flowSign}
                maxFlow={maxFlow}
                pipeSize={p.size}
                opacity={headOpacity}
                onClick={openPopup("pipe", p.name, p.properties)}
                onPointerOver={() => hoverIn("p:" + p.name)}
                onPointerOut={hoverOut}
                highlighted={hoveredElement === "p:" + p.name}
              />
            ))}

          {/* Reservoir risers */}
          {layerVis.reservoirs &&
            reservoirRisers.head.map((ri) => (
              <AnimatedRiser
                key={ri.key}
                x={ri.x}
                y={ri.y}
                z1={ri.z1}
                z2={ri.z2}
                color={HEAD_COLOR}
                lineWidth={2}
                opacity={headOpacity * 0.7}
              />
            ))}
        </group>
      )}

      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={[0, 0, 5]}
        enableDamping
        dampingFactor={0.25}
        rotateSpeed={1.4}
        panSpeed={0.8}
        zoomSpeed={1.2}
        zoomToCursor
        minZoom={10}
        maxZoom={8000}
        minPolarAngle={0}
        maxPolarAngle={Math.PI}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
        touches={{
          ONE: THREE.TOUCH.ROTATE,
          TWO: THREE.TOUCH.DOLLY_PAN,
        }}
      />

      <GizmoHelper alignment="top-left" margin={[48, 48]}>
        <CustomViewcube
          faces={["Right", "Left", "Back", "Front", "Top", "Bottom"]}
          color="white"
          strokeColor="#94a3b8"
          textColor="#334155"
          hoverColor="#93c5fd"
          opacity={0.95}
        />
      </GizmoHelper>

      <FaceOnDetector
        controlsRef={controlsRef}
        onFaceOnChange={onFaceOnChange}
        onSideFaceOnChange={onSideFaceOnChange}
      />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  MAIN EXPORTED COMPONENT                                   */
/* ═══════════════════════════════════════════════════════════ */
export default function GeoPanel3D({
  hydraulicResults,
  valveOverrides,
  onValveOverrideChange,
  elevOverrides,
  onElevOverrideChange,
  layerVis,
}) {
  const [isFaceOn, setIsFaceOn] = useState(false);
  const [isSideFaceOn, setIsSideFaceOn] = useState(false);
  const [elevOpacity, setElevOpacity] = useState(1);
  const [headOpacity, setHeadOpacity] = useState(0.6);
  const [popup, setPopup] = useState(null);
  const popupRef = useRef(null);

  /* ── Close modal on ESC ── */
  useEffect(() => {
    if (!popup) return;
    const onKey = (e) => {
      if (e.key === "Escape") setPopup(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popup]);

  /* ── Close modal on outside click ── */
  useEffect(() => {
    if (!popup) return;
    const onDown = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setPopup(null);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [popup]);

  /* ── Build popup content ── */
  const popupContent = useMemo(() => {
    if (!popup) return null;
    const { type, name, properties } = popup;
    switch (type) {
      case "node":
        return <NodePopup properties={properties} results={hydraulicResults} />;
      case "pipe":
        return <PipePopup properties={properties} results={hydraulicResults} />;
      case "valve":
        return (
          <ValvePopup
            properties={properties}
            results={hydraulicResults}
            overrides={valveOverrides?.[name]}
            onOverrideChange={(o) => onValveOverrideChange?.(name, o)}
          />
        );
      case "reservoir":
        return (
          <ReservoirPopup
            properties={properties}
            results={hydraulicResults}
            elevOverride={elevOverrides?.[name]}
            onElevChange={(elev) => onElevOverrideChange?.(name, elev)}
          />
        );
      case "overflow":
        return (
          <OverflowPopup
            properties={properties}
            results={hydraulicResults}
            elevOverride={elevOverrides?.[name]}
            onElevChange={(elev) => onElevOverrideChange?.(name, elev)}
          />
        );
      default:
        return null;
    }
  }, [
    popup,
    hydraulicResults,
    valveOverrides,
    elevOverrides,
    onValveOverrideChange,
    onElevOverrideChange,
  ]);

  return (
    <div className="three-d-container">
      <Canvas
        orthographic
        camera={{ zoom: 35, near: -200, far: 400, position: [0, -20, 18] }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor("#f0f2f5");
        }}
      >
        <GeoSceneContent
          hydraulicResults={hydraulicResults}
          valveOverrides={valveOverrides}
          onValveOverrideChange={onValveOverrideChange}
          elevOverrides={elevOverrides}
          onElevOverrideChange={onElevOverrideChange}
          elevOpacity={elevOpacity}
          headOpacity={headOpacity}
          layerVis={layerVis}
          onFaceOnChange={setIsFaceOn}
          onSideFaceOnChange={setIsSideFaceOn}
          isSideFaceOn={isSideFaceOn}
          popup={popup}
          setPopup={setPopup}
        />
      </Canvas>

      {/* CW / CCW rotate buttons */}
      <div className="face-rotate-controls">
        <button
          className="face-rotate-btn"
          title="Rotate view 90° counter-clockwise"
          disabled={!isFaceOn}
          onClick={() => {
            _geoRotatePending = { angle: 90 };
          }}
        >
          ↶
        </button>
        <button
          className="face-rotate-btn"
          title="Rotate view 90° clockwise"
          disabled={!isFaceOn}
          onClick={() => {
            _geoRotatePending = { angle: -90 };
          }}
        >
          ↷
        </button>
      </div>

      {/* Overlay opacity controls */}
      <div className="overlay-controls">
        <div className="overlay-section-label">Total Head</div>
        <div className="overlay-slider-row">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(headOpacity * 100)}
            onChange={(e) => setHeadOpacity(e.target.value / 100)}
          />
          <span className="overlay-slider-pct">
            {Math.round(headOpacity * 100)}%
          </span>
        </div>
        <div className="overlay-section-label" style={{ marginTop: 12 }}>
          Elevation
        </div>
        <div className="overlay-slider-row">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(elevOpacity * 100)}
            onChange={(e) => setElevOpacity(e.target.value / 100)}
          />
          <span className="overlay-slider-pct">
            {Math.round(elevOpacity * 100)}%
          </span>
        </div>
      </div>

      {/* ── Popup modal overlay ── */}
      {popup && popupContent && (
        <div className="three-d-modal-backdrop">
          <div
            ref={popupRef}
            className="three-d-popup-wrapper"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="three-d-popup-close"
              onClick={() => setPopup(null)}
            >
              ×
            </button>
            {popupContent}
          </div>
        </div>
      )}
    </div>
  );
}
