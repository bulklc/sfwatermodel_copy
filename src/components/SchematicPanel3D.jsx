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
  nodesSch,
  pipesSch,
  valvesSch,
  reservoirsSch,
  overflowSch,
} from "../data.js";
import NodePopup from "./popups/NodePopup.jsx";
import PipePopup from "./popups/PipePopup.jsx";
import ValvePopup from "./popups/ValvePopup.jsx";
import ReservoirPopup from "./popups/ReservoirPopup.jsx";
import OverflowPopup from "./popups/OverflowPopup.jsx";
import { fmtNum } from "../utils/fmt.js";
import "./SchematicPanel3D.css";

/* ───────── constants ───────── */
const ELEV_MIN = 900;
const ELEV_MAX = 2250;
const Z_RANGE = 8; // visual Z units
const scaleZ = (val) => ((val - ELEV_MIN) / (ELEV_MAX - ELEV_MIN)) * Z_RANGE;

const ELEV_COLOR = "#95C13D";
const HEAD_COLOR = "#4A90D9";
const RESERVOIR_Z_BOOST = 0.5; // lift reservoir/overflow boxes above connected elements
const RESERVOIR_THICKNESS = 0.6; // Z-height of reservoir box
const OVERFLOW_SIDE = 0.6; // XY side length of overflow square prism
const OVERFLOW_RADIUS = OVERFLOW_SIDE / 2; // radius for overflow cylinder
const LERP_SPEED = 8; // exponential lerp rate for smooth transitions

/* ───────── animated dashed pipe ───────── */
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

  // Animation: lerp line points toward target
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

    // Position lerping
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

    // Dash animation
    if (hasFlow) {
      const mat = lineRef.current.material;
      if (mat) {
        mat.dashOffset += speed * sign * dt;
      }
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

/* ───────── node sphere ───────── */
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

  // Animation: lerp position
  const currentPos = useRef(position.slice());
  const targetPos = useRef(position);
  targetPos.current = position;

  useFrame((_, dt) => {
    if (!meshRef.current) return;
    const alpha = 1 - Math.exp(-LERP_SPEED * dt);
    const c = currentPos.current;
    const t = targetPos.current;
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

/* ───────── reservoir box ───────── */
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

  // Animation: lerp center position
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

/* ───────── overflow cylinder ───────── */
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

  const height = Math.max(zTop - zBottom, 0.02);
  const zCenter = (zBottom + zTop) / 2;

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

/* ───────── animated riser line ───────── */
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

/* ───────── ground grid ───────── */
function GroundGrid() {
  return (
    <gridHelper
      args={[30, 30, "#cbd5e1", "#e2e8f0"]}
      position={[14, 0, -5]}
      rotation={[Math.PI / 2, 0, 0]}
    />
  );
}

/* ───────── camera auto-fit on mount ───────── */
function CameraSetup() {
  const { camera } = useThree();
  useEffect(() => {
    camera.up.set(0, 0, 1); // Z is up
    camera.position.set(14, -18, 14);
    camera.lookAt(14, 5, 3);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

/* ───────── pointer cursor helper ───────── */
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

/* ───────── face-on detector + rotator ───────── */
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const FACE_THRESHOLD = 0.02; // how close to axis-aligned counts as face-on

/* Module-level rotation command — bypasses React/R3F boundary entirely */
let _rotatePending = null; // { angle: number } or null

/* Module-level viewcube navigation for top/bottom (bypasses GizmoHelper's
   degenerate lookAt when camera.up is parallel to view direction) */
let _viewcubeNav = null; // { direction: THREE.Vector3 } or null

/* Module-level animation state for smooth rotation */
let _rotateAnim = null; // { startQ, endQ, startUp, endUp, t, duration } or null
const ROTATE_DURATION = 0.3; // seconds
const VIEWCUBE_DURATION = 0.4; // seconds — slightly longer for viewcube nav

/* Custom viewcube wrapper — intercepts top/bottom clicks to avoid
   GizmoHelper's degenerate quaternion when looking along Z */
function CustomViewcube(props) {
  const { tweenCamera } = useGizmoContext();

  const handleClick = useCallback(
    (e) => {
      e.stopPropagation();
      // Determine the intended camera direction
      let direction;
      if (e.face && e.object.position.lengthSq() < 0.01) {
        // Face click (FaceCube mesh at origin)
        direction = e.face.normal.clone();
      } else {
        // Edge or corner click
        direction = e.object.position.clone().normalize();
      }

      // Intercept pure top/bottom face clicks (Z-axis dominant)
      if (
        Math.abs(direction.z) > 0.9 &&
        Math.abs(direction.x) < 0.1 &&
        Math.abs(direction.y) < 0.1
      ) {
        _viewcubeNav = { direction: direction.clone() };
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

/* ───────── Z-axis overlay (gridlines + labels) ───────── */
const Z_AXIS_MAX_ELEV = 2400; // gridlines/labels extend beyond data range
const Z_AXIS_TICKS = [];
{
  const minor = 50; // ft per minor division
  const major = 100; // ft per major division
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
  const _dir = useMemo(() => new THREE.Vector3(), []);
  const _right = useMemo(() => new THREE.Vector3(), []);
  // Track last computed endpoint coords for the highlight line
  const lastEndpoints = useRef({ lx: 0, ly: 0, rx: 0, ry: 0 });

  const majorTicks = useMemo(() => Z_AXIS_TICKS.filter((t) => t.major), []);
  const minorTicks = useMemo(() => Z_AXIS_TICKS.filter((t) => !t.major), []);

  // Pre-allocate dynamic buffers (2 vertices × 3 floats per line)
  const majorPositions = useMemo(
    () => new Float32Array(majorTicks.length * 6),
    [majorTicks],
  );
  const minorPositions = useMemo(
    () => new Float32Array(minorTicks.length * 6),
    [minorTicks],
  );
  const highlightPositions = useMemo(() => new Float32Array(6), []); // single line

  const HALF_SPAN = 18; // world units — gridline half-width from center
  const LABEL_GAP = 3.0; // world units beyond gridline end to label anchor

  const setHovered = useCallback(
    (idx) => {
      if (hoveredIdxRef.current === idx) return;
      hoveredIdxRef.current = idx;
      // Update label styles immediately
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
      // Update highlight line
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

    // Material opacity
    groupRef.current.traverse((child) => {
      if (child.material) {
        child.material.opacity = op * (child.userData.baseOpacity ?? 1);
        child.material.needsUpdate = true;
      }
    });

    // Label opacity
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

    // Highlight line opacity
    if (highlightMatRef.current && hoveredIdxRef.current >= 0) {
      highlightMatRef.current.opacity = op * 0.7;
    }

    // Compute camera's screen-right direction projected onto horizontal plane
    camera.getWorldDirection(_dir);
    _dir.z = 0;
    if (_dir.lengthSq() < 0.001) return; // looking straight up/down
    _dir.normalize();
    // right = viewDir × Z-up  →  (-dy, dx, 0)
    _right.set(-_dir.y, _dir.x, 0);

    const orbitTarget = controlsRef?.current?.target;
    const cx = orbitTarget?.x ?? 14;
    const cy = orbitTarget?.y ?? 5;

    // Left / right endpoints
    const lx = cx - _right.x * HALF_SPAN;
    const ly = cy - _right.y * HALF_SPAN;
    const rx = cx + _right.x * HALF_SPAN;
    const ry = cy + _right.y * HALF_SPAN;
    lastEndpoints.current = { lx, ly, rx, ry };

    // Update major gridline positions
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

    // Update minor gridline positions
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

    // Update highlight line if hovered
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

    // Update label group positions (left labels at left end, right labels at right end)
    const lgx = cx - _right.x * (HALF_SPAN + LABEL_GAP);
    const lgy = cy - _right.y * (HALF_SPAN + LABEL_GAP);
    const rgx = cx + _right.x * (HALF_SPAN + LABEL_GAP);
    const rgy = cy + _right.y * (HALF_SPAN + LABEL_GAP);
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
      {/* Major gridlines */}
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

      {/* Minor gridlines */}
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

      {/* Highlight gridline (shown on hover) */}
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

      {/* Left labels (right-aligned, just beyond left end of gridlines) */}
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

      {/* Right labels (left-aligned, just beyond right end of gridlines) */}
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

function FaceOnDetector({ controlsRef, onFaceOnChange, onSideFaceOnChange }) {
  const { camera, invalidate } = useThree();
  const wasFaceOn = useRef(false);
  const wasSideFaceOn = useRef(false);

  useFrame((_, delta) => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;

    // 1a. Start viewcube navigation (top/bottom) if pending
    if (_viewcubeNav) {
      const { direction } = _viewcubeNav;
      _viewcubeNav = null;

      const target = controls.target;
      const radius = camera.position.distanceTo(target);
      const endPos = direction.clone().multiplyScalar(radius).add(target);
      // For top view (looking down -Z), up should be (0,1,0).
      // For bottom view (looking up +Z), up should be (0,1,0) as well.
      const endUp = new THREE.Vector3(0, 1, 0);

      const startQ = camera.quaternion.clone();
      const tempCam = camera.clone();
      tempCam.up.copy(endUp);
      tempCam.position.copy(endPos);
      tempCam.lookAt(target);
      tempCam.updateMatrixWorld(true);
      const endQ = tempCam.quaternion.clone();

      _rotateAnim = {
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

    // 1b. Start a new animated rotation if pending
    if (_rotatePending) {
      const { angle: angleDeg } = _rotatePending;
      _rotatePending = null;

      const target = controls.target;
      const dir = new THREE.Vector3()
        .subVectors(target, camera.position)
        .normalize();
      const angle = THREE.MathUtils.degToRad(angleDeg);
      const q = new THREE.Quaternion().setFromAxisAngle(dir, angle);

      // Compute target camera.up (snapped to axis)
      const targetUp = camera.up.clone().applyQuaternion(q).normalize();
      const ux = Math.abs(targetUp.x),
        uy = Math.abs(targetUp.y),
        uz = Math.abs(targetUp.z);
      if (ux >= uy && ux >= uz) targetUp.set(Math.sign(targetUp.x), 0, 0);
      else if (uy >= ux && uy >= uz) targetUp.set(0, Math.sign(targetUp.y), 0);
      else targetUp.set(0, 0, Math.sign(targetUp.z));

      // Compute target camera position
      const offset = new THREE.Vector3().subVectors(camera.position, target);
      const targetOffset = offset.clone().applyQuaternion(q);

      // Capture start quaternion from current camera orientation
      const startQ = camera.quaternion.clone();
      // Compute end quaternion by placing camera at target position
      const endPos = target.clone().add(targetOffset);
      const tempCam = camera.clone();
      tempCam.up.copy(targetUp);
      tempCam.position.copy(endPos);
      tempCam.lookAt(target);
      tempCam.updateMatrixWorld(true);
      const endQ = tempCam.quaternion.clone();

      _rotateAnim = {
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

    // 2. Animate rotation in progress
    if (_rotateAnim) {
      _rotateAnim.t += delta;
      const raw = Math.min(_rotateAnim.t / _rotateAnim.duration, 1);
      // Smooth ease-in-out
      const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;

      camera.position.lerpVectors(_rotateAnim.startPos, _rotateAnim.endPos, t);
      camera.up
        .lerpVectors(_rotateAnim.startUp, _rotateAnim.endUp, t)
        .normalize();
      camera.quaternion.slerpQuaternions(
        _rotateAnim.startQ,
        _rotateAnim.endQ,
        t,
      );
      camera.updateMatrixWorld(true);
      controls.update();
      invalidate();

      if (raw >= 1) {
        // Snap to exact final values
        camera.position.copy(_rotateAnim.endPos);
        camera.up.copy(_rotateAnim.endUp);
        camera.lookAt(controls.target);
        camera.updateMatrixWorld(true);
        controls.update();
        _rotateAnim = null;
      }
    }

    // 3. Fix degenerate camera.up when looking along Z-axis (top/bottom)
    //    GizmoHelper resets camera.up to (0,0,1) after animation, which is
    //    parallel to the view direction for top/bottom views → undefined roll.
    _dir.subVectors(controls.target, camera.position).normalize();
    const upDotView = Math.abs(camera.up.dot(_dir));
    if (upDotView > 0.99) {
      // Degenerate: camera.up is ~parallel to view direction.
      // Use (0,1,0) for top view so X→right, Y→up matching 2D schematic layout.
      if (_dir.z < 0)
        camera.up.set(0, 1, 0); // top view
      else camera.up.set(0, 1, 0); // bottom view
      controls.update();
      invalidate();
    }

    // 4. Detect face-on
    const ax = Math.abs(_dir.x),
      ay = Math.abs(_dir.y),
      az = Math.abs(_dir.z);
    const isFaceOn =
      (ax > 1 - FACE_THRESHOLD && ay < FACE_THRESHOLD && az < FACE_THRESHOLD) ||
      (ay > 1 - FACE_THRESHOLD && ax < FACE_THRESHOLD && az < FACE_THRESHOLD) ||
      (az > 1 - FACE_THRESHOLD && ax < FACE_THRESHOLD && ay < FACE_THRESHOLD);

    if (isFaceOn !== wasFaceOn.current) {
      wasFaceOn.current = isFaceOn;
      onFaceOnChange(isFaceOn);
    }

    // Side face-on = looking horizontally (Z component near zero)
    // Covers 4 face-on views (Front/Back/Left/Right) AND 4 edge views
    const isSideFaceOn = az < FACE_THRESHOLD;
    if (isSideFaceOn !== wasSideFaceOn.current) {
      wasSideFaceOn.current = isSideFaceOn;
      onSideFaceOnChange(isSideFaceOn);
    }
  });

  return null;
}

/* ═══════════════════════════════════════════════ */
/*  SCENE CONTENT – renders inside <Canvas>       */
/* ═══════════════════════════════════════════════ */
function SceneContent({
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
  const { camera, size, gl } = useThree();
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
      // Check for elev override
      const ov = elevOverrides?.[name];
      if (ov != null) return ov;
      return fallbackElev;
    },
    [elevOverrides],
  );

  /* ── Build element arrays ── */
  const nodeElements = useMemo(() => {
    return nodesSch.features.map((f) => {
      const name = f.properties.name;
      const [x, y] = f.geometry.coordinates;
      const elev = getNodeElev(name, f.properties.elev);
      const head = getNodeHead(name);
      return { name, x, y, elev, head, properties: f.properties };
    });
  }, [getNodeElev, getNodeHead]);

  const valveElements = useMemo(() => {
    return valvesSch.features.map((f) => {
      const name = f.properties.name;
      const [x, y] = f.geometry.coordinates;
      const elev = f.properties.elev;
      // For valves, we can compute head from upstream/downstream
      const vRes = r?.valves?.[name];
      const head = vRes ? (vRes.us_head + vRes.ds_head) / 2 : null;
      return { name, x, y, elev, head, properties: f.properties, vRes };
    });
  }, [r]);

  // All node + valve positions for reservoir proximity expansion
  const allNodeValvePositions = useMemo(() => {
    const pts = [];
    for (const f of nodesSch.features) {
      const [x, y] = f.geometry.coordinates;
      pts.push({ x, y, elev: f.properties.elev });
    }
    for (const f of valvesSch.features) {
      const [x, y] = f.geometry.coordinates;
      pts.push({ x, y, elev: f.properties.elev });
    }
    return pts;
  }, []);

  const reservoirElements = useMemo(() => {
    return reservoirsSch.features.map((f) => {
      const name = f.properties.name;
      const resElev = f.properties.elev;
      const elev = getNodeElev(name, resElev);
      const head = getNodeHead(name);
      const ring = f.geometry.coordinates[0][0];
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const [px, py] of ring) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      // Expand bbox to cover nearby nodes/valves at similar elevation.
      // This positions the reservoir box "over" its inlet infrastructure.
      const origW = maxX - minX,
        origH = maxY - minY;
      const ctrX = (minX + maxX) / 2,
        ctrY = (minY + maxY) / 2;
      const maxDist = Math.max(Math.max(origW, origH) * 1.25, 2.5);
      const elevThresh = 150; // ft
      let eMinX = minX,
        eMaxX = maxX,
        eMinY = minY,
        eMaxY = maxY;
      for (const el of allNodeValvePositions) {
        const d = Math.hypot(el.x - ctrX, el.y - ctrY);
        if (d <= maxDist && Math.abs(el.elev - resElev) <= elevThresh) {
          eMinX = Math.min(eMinX, el.x);
          eMaxX = Math.max(eMaxX, el.x);
          eMinY = Math.min(eMinY, el.y);
          eMaxY = Math.max(eMaxY, el.y);
        }
      }
      return {
        name,
        elev,
        head,
        cx: (eMinX + eMaxX) / 2,
        cy: (eMinY + eMaxY) / 2,
        w: eMaxX - eMinX + 0.6, // pad so box visually encloses nodes
        h: eMaxY - eMinY + 0.6,
        eMinX: eMinX - 0.3, // padded expanded bounds (unused for risers)
        eMaxX: eMaxX + 0.3,
        eMinY: eMinY - 0.3,
        eMaxY: eMaxY + 0.3,
        // Original polygon bounds — used for riser detection so only
        // pipe endpoints at the actual reservoir edge get risers.
        oMinX: minX - 0.3,
        oMaxX: maxX + 0.3,
        oMinY: minY - 0.3,
        oMaxY: maxY + 0.3,
        properties: f.properties,
      };
    });
  }, [getNodeElev, getNodeHead, allNodeValvePositions]);

  const overflowElements = useMemo(() => {
    return overflowSch.features.map((f) => {
      const name = f.properties.name;
      const weirCrestElev = getNodeElev(name, f.properties.elev); // overflow polygon elev = weir crest
      const head = getNodeHead(name);
      const isActive = r?.overflow?.[name]?.active;

      // The overflow junction node has the shaft bottom elevation
      const ovNode = nodesSch.features.find(
        (nf) => nf.properties.name === name,
      );
      const nodeElev = ovNode ? ovNode.properties.elev : weirCrestElev;

      // Find the nearest reservoir to position this overflow relative to it
      let nearestRes = null;
      let nearestDist = Infinity;
      const ovX = ovNode ? ovNode.geometry.coordinates[0] : 0;
      const ovY = ovNode ? ovNode.geometry.coordinates[1] : 0;
      for (const res of reservoirElements) {
        const d = Math.hypot(ovX - res.cx, ovY - res.cy);
        if (d < nearestDist) {
          nearestDist = d;
          nearestRes = res;
        }
      }

      const cx = ovX;
      const cy = ovY;

      return {
        name,
        nodeElev, // bottom of shaft (junction elevation)
        weirCrestElev, // top of shaft (weir crest elevation)
        elev: weirCrestElev, // kept for backward compat
        head,
        cx,
        cy,
        parentRes: nearestRes,
        isActive,
        properties: f.properties,
      };
    });
  }, [getNodeElev, getNodeHead, r, reservoirElements]);

  // Build a lookup of valve XY → displayed head Z so pipes can snap to them
  const valveHeadZByXY = useMemo(() => {
    const map = new Map();
    for (const v of valveElements) {
      if (v.head != null) {
        // Key by rounded XY to handle floating point
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

  // Build name→[x,y] lookup for pipe endpoint matching (schematic coords).
  // Used to determine whether a pipe's coordinates run us→ds or ds→us.
  const nodeCoordMap3D = useMemo(() => {
    const m = new Map();
    for (const fc of [nodesSch, valvesSch]) {
      if (!fc?.features) continue;
      for (const f of fc.features) {
        const name = f.properties?.name;
        const c = f.geometry?.coordinates;
        if (name && c) m.set(name, [c[0], c[1]]);
      }
    }
    for (const fc of [reservoirsSch, overflowSch]) {
      if (!fc?.features) continue;
      for (const f of fc.features) {
        const name = f.properties?.name;
        const c = f.geometry?.coordinates;
        if (!name || !c) continue;
        const ring = c?.[0]?.[0] || c?.[0];
        if (!ring?.length) continue;
        const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
        const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        m.set(name, [cx, cy]);
      }
    }
    return m;
  }, []);

  const pipeElements = useMemo(() => {
    return pipesSch.features.map((f) => {
      const name = f.properties.name;
      const pRes = r?.pipes?.[name];
      const flow = pRes?.flow || 0;
      const usElev = pRes?.us_elev ?? 0;
      const dsElev = pRes?.ds_elev ?? 0;
      const usHead = pRes?.us_head ?? 0;
      const dsHead = pRes?.ds_head ?? 0;

      // Build 3D points from 2D schematic line
      const coords =
        f.geometry.type === "MultiLineString" ?
          f.geometry.coordinates[0]
        : f.geometry.coordinates;
      const n = coords.length;
      const elevPoints = coords.map(([x, y], i) => {
        const t = n > 1 ? i / (n - 1) : 0;
        let z = scaleZ(usElev + (dsElev - usElev) * t);
        // Snap endpoints to valve displayed elevation
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
        // Snap endpoints to valve displayed head
        if (i === 0 || i === n - 1) {
          const key = `${x.toFixed(4)},${y.toFixed(4)}`;
          const vz = valveHeadZByXY.get(key);
          if (vz != null) z = vz;
        }
        return [x, y, z];
      });
      // Determine animation direction from EPANET flow sign.
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

  // Vertical risers: for each pipe endpoint or valve that sits under a
  // reservoir's XY footprint, draw a vertical line from the element up to
  // the reservoir bottom.  We compute separate risers for elev and head.
  const reservoirRisers = useMemo(() => {
    const risers = { elev: [], head: [] };
    for (const res of reservoirElements) {
      const elevBotZ =
        scaleZ(res.elev) + RESERVOIR_Z_BOOST - RESERVOIR_THICKNESS / 2;
      const headBotZ =
        res.head != null ?
          scaleZ(res.head) + RESERVOIR_Z_BOOST - RESERVOIR_THICKNESS / 2
        : null;

      // Use ORIGINAL polygon bounds for riser detection so only
      // elements at the reservoir boundary get risers, not everything
      // under the expanded visual box (e.g. sluice gates, branch nodes).
      const isInside = (x, y) =>
        x >= res.oMinX && x <= res.oMaxX && y >= res.oMinY && y <= res.oMaxY;

      // Check valve positions
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

      // Check pipe endpoints
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

      <GroundGrid />
      <ZAxisOverlay visible={isSideFaceOn} controlsRef={controlsRef} />

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
                onClick={openPopup("node", n.name, n.properties, [
                  n.x,
                  n.y,
                  scaleZ(n.elev),
                ])}
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
                onClick={openPopup("valve", v.name, v.properties, [
                  v.x,
                  v.y,
                  scaleZ(v.elev),
                ])}
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
                <ReservoirBox
                  key={`elev-r-${res.name}`}
                  center={[res.cx, res.cy, z]}
                  size={[res.w, res.h, RESERVOIR_THICKNESS]}
                  color="#a6cde3"
                  opacity={elevOpacity}
                  onClick={openPopup("reservoir", res.name, res.properties, [
                    res.cx,
                    res.cy,
                    z,
                  ])}
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
                  onClick={openPopup("overflow", ov.name, ov.properties, [
                    ov.cx,
                    ov.cy,
                    (zBottom + zTop) / 2,
                  ])}
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
                onClick={openPopup("pipe", p.name, p.properties, [
                  p.elevPoints[0][0],
                  p.elevPoints[0][1],
                  p.elevPoints[0][2],
                ])}
                onPointerOver={() => hoverIn("p:" + p.name)}
                onPointerOut={hoverOut}
                highlighted={hoveredElement === "p:" + p.name}
              />
            ))}

          {/* Vertical risers — pipes/valves up to reservoir bottom */}
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
                  onClick={openPopup("node", n.name, n.properties, [
                    n.x,
                    n.y,
                    scaleZ(n.head),
                  ])}
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
                  onClick={openPopup("valve", v.name, v.properties, [
                    v.x,
                    v.y,
                    scaleZ(v.head),
                  ])}
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
                  <ReservoirBox
                    key={`head-r-${res.name}`}
                    center={[res.cx, res.cy, z]}
                    size={[res.w, res.h, RESERVOIR_THICKNESS]}
                    color={HEAD_COLOR}
                    opacity={headOpacity}
                    onClick={openPopup("reservoir", res.name, res.properties, [
                      res.cx,
                      res.cy,
                      z,
                    ])}
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
                    onClick={openPopup("overflow", ov.name, ov.properties, [
                      ov.cx,
                      ov.cy,
                      (zBottom + zTop) / 2,
                    ])}
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
                onClick={openPopup("pipe", p.name, p.properties, [
                  p.headPoints[0][0],
                  p.headPoints[0][1],
                  p.headPoints[0][2],
                ])}
                onPointerOver={() => hoverIn("p:" + p.name)}
                onPointerOut={hoverOut}
                highlighted={hoveredElement === "p:" + p.name}
              />
            ))}

          {/* Vertical risers — pipes/valves up to reservoir bottom */}
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
        target={[14, 5, 3]}
        enableDamping
        dampingFactor={0.25}
        rotateSpeed={1.4}
        panSpeed={0.8}
        zoomSpeed={1.2}
        zoomToCursor
        minZoom={10}
        maxZoom={150}
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

/* ═══════════════════════════════════════════════ */
/*  MAIN EXPORTED COMPONENT                       */
/* ═══════════════════════════════════════════════ */
export default function SchematicPanel3D({
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
        camera={{ zoom: 38, near: -200, far: 400, position: [14, -18, 14] }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor("#f0f2f5");
        }}
      >
        <SceneContent
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

      {/* CW / CCW rotate buttons — always visible below viewcube,
          disabled when not in face-on mode */}
      <div className="face-rotate-controls">
        <button
          className="face-rotate-btn"
          title="Rotate view 90° counter-clockwise"
          disabled={!isFaceOn}
          onClick={() => {
            _rotatePending = { angle: 90 };
          }}
        >
          ↶
        </button>
        <button
          className="face-rotate-btn"
          title="Rotate view 90° clockwise"
          disabled={!isFaceOn}
          onClick={() => {
            _rotatePending = { angle: -90 };
          }}
        >
          ↷
        </button>
      </div>

      {/* Overlay opacity controls — positioned left of the 2×2 switch */}
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
