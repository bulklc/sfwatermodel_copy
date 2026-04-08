import { useState, useEffect, useCallback, useMemo } from "react";
import MapPanel from "./components/MapPanel.jsx";
import SchematicPanel3D from "./components/SchematicPanel3D.jsx";
import GeoPanel3D from "./components/GeoPanel3D.jsx";
import ViewModeSwitch from "./components/ViewModeSwitch.jsx";
import HelpModal from "./components/HelpModal.jsx";
import { runHydraulicModel } from "./epanetModel.js";
import { fmtNum } from "./utils/fmt.js";
import "./App.css";
import "./components/HelpModal.css";

/* ── Shared layer definitions ──────────────────── */
const LAYER_DEFS = [
  { id: "reservoirs", label: "Reservoirs", color: "#a6cde3" },
  { id: "overflow", label: "Overflow", color: "#a6cde3" },
  { id: "pipes", label: "Pipes", color: "#1f78b4" },
  { id: "nodes", label: "Nodes", color: "#000000" },
  { id: "valves", label: "Valves", color: "#1f78b4" },
  { id: "basemap", label: "Basemap", color: null, geoOnly: true },
];

function LayerControl({ visibility, onToggle, viewMode }) {
  const isGeo = viewMode === "2d-geo" || viewMode === "3d-geo";
  return (
    <div className="layer-control">
      {LAYER_DEFS.filter(({ geoOnly }) => !geoOnly || isGeo).map(
        ({ id, label, color }) => (
          <label key={id} className="layer-control-item">
            <input
              type="checkbox"
              checked={visibility[id]}
              onChange={() => onToggle(id)}
            />
            {color ?
              <span
                className="layer-control-swatch"
                style={{ background: color }}
              />
            : <span className="layer-control-swatch-placeholder" />}
            <span className="layer-control-label">{label}</span>
          </label>
        ),
      )}
    </div>
  );
}

export default function App() {
  const [results, setResults] = useState(null);
  const [modelError, setModelError] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [viewMode, setViewMode] = useState("2d-geo");

  /* Shared layer visibility — single state for all view modes */
  const [layerVis, setLayerVis] = useState({
    basemap: true,
    reservoirs: true,
    overflow: true,
    pipes: true,
    nodes: true,
    valves: true,
  });
  const toggleLayer = useCallback(
    (id) => setLayerVis((prev) => ({ ...prev, [id]: !prev[id] })),
    [],
  );
  const [valveOverrides, setValveOverrides] = useState({
    mocc_ph_turbine_1_inlet: {
      mode: "throttled",
      calcType: "FCV",
      setting: 323,
      status: "open",
    },
    mocc_ph_turbine_2_inlet: {
      mode: "throttled",
      calcType: "FCV",
      setting: 323,
      status: "open",
    },
  });
  const [elevOverrides, setElevOverrides] = useState({});

  useEffect(() => {
    setModelError(null);
    runHydraulicModel(valveOverrides, elevOverrides)
      .then(setResults)
      .catch((err) => {
        console.error("EPANET model error:", err);
        setModelError(err.message);
      });
  }, [valveOverrides, elevOverrides]);

  const handleValveOverrideChange = useCallback((valveName, override) => {
    setValveOverrides((prev) => ({ ...prev, [valveName]: override }));
  }, []);

  const handleElevOverrideChange = useCallback((name, elev) => {
    setElevOverrides((prev) => ({ ...prev, [name]: elev }));
  }, []);

  // Derive active overflow entries from results
  const activeOverflows = useMemo(() => {
    if (!results?.overflow) return [];
    return Object.entries(results.overflow)
      .filter(([, v]) => v.active)
      .map(([name, v]) => ({ name, flow: v.flow }));
  }, [results]);

  return (
    <div className="app-container">
      <div className="main-panel">
        {activeOverflows.length > 0 && (
          <div className="overflow-banner">
            <span className="overflow-banner-icon">⚠</span>
            {activeOverflows.map((o) => (
              <span key={o.name} className="overflow-banner-text">
                Overflow Active — {fmtNum(o.flow, 4)} MGD
              </span>
            ))}
          </div>
        )}
        <div className="view-mode-switch-wrapper">
          <ViewModeSwitch activeMode={viewMode} onModeChange={setViewMode} />
        </div>
        {results && viewMode === "3d-geo" && (
          <GeoPanel3D
            hydraulicResults={results}
            valveOverrides={valveOverrides}
            onValveOverrideChange={handleValveOverrideChange}
            elevOverrides={elevOverrides}
            onElevOverrideChange={handleElevOverrideChange}
            layerVis={layerVis}
          />
        )}
        {results && viewMode === "3d-sch" && (
          <SchematicPanel3D
            hydraulicResults={results}
            valveOverrides={valveOverrides}
            onValveOverrideChange={handleValveOverrideChange}
            elevOverrides={elevOverrides}
            onElevOverrideChange={handleElevOverrideChange}
            layerVis={layerVis}
          />
        )}
        {results && (viewMode === "2d-geo" || viewMode === "2d-sch") && (
          <MapPanel
            hydraulicResults={results}
            valveOverrides={valveOverrides}
            onValveOverrideChange={handleValveOverrideChange}
            elevOverrides={elevOverrides}
            onElevOverrideChange={handleElevOverrideChange}
            viewMode={viewMode}
            layerVis={layerVis}
          />
        )}
        <LayerControl
          visibility={layerVis}
          onToggle={toggleLayer}
          viewMode={viewMode}
        />
        {modelError && (
          <div className="status-overlay status-error">
            Model error: {modelError}
          </div>
        )}
        {!results && !modelError && (
          <div className="status-overlay">Running hydraulic model…</div>
        )}
        <button
          className="help-button"
          onClick={() => setHelpOpen(true)}
          title="About this application"
        >
          ?
        </button>
      </div>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
