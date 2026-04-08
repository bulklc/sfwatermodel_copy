import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  useMap,
  CircleMarker,
  Popup,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  nodes,
  pipes,
  valves,
  reservoirs,
  overflow,
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

/* Fix default Leaflet marker icon paths (not needed for CircleMarkers, but just in case) */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

/* ---- style helpers ---- */
const sizeToValveRadius = (size) => {
  // Map valve sizes (48–120) to radii (5–14)
  const minSize = 48,
    maxSize = 120,
    minR = 5,
    maxR = 14;
  return minR + ((size - minSize) / (maxSize - minSize)) * (maxR - minR);
};

const sizeToPipeWeight = (size) => {
  // Map pipe sizes (48–120) to stroke widths (2–8)
  const minSize = 48,
    maxSize = 120,
    minW = 2,
    maxW = 8;
  return minW + ((size - minSize) / (maxSize - minSize)) * (maxW - minW);
};

const pointToLayer = (color, pane) => (feature, latlng) =>
  L.circleMarker(latlng, {
    radius: sizeToValveRadius(feature.properties.size || 48),
    fillColor: color,
    color: "#232323",
    weight: 1,
    fillOpacity: 1,
    pane: pane || "markerPane",
  });

const polygonStyle = (fill) => () => ({
  color: "#232323",
  weight: 1,
  fillColor: fill,
  fillOpacity: 0.5,
});

/* ---- popup builder + hover highlight ---- */

// Global tracker: ensures only one layer is highlighted at a time.
// When mouseout is missed (e.g. due to bringToFront DOM reorder),
// the next mouseover will still clear the previous highlight.
let _highlightedLayer = null;
let _highlightedSavedStyle = null;

function _clearHighlight() {
  if (_highlightedLayer && _highlightedLayer.setStyle) {
    _highlightedLayer.setStyle(_highlightedSavedStyle);
  }
  _highlightedLayer = null;
  _highlightedSavedStyle = null;
}

function getPipeColor(pipeName, resultsRef) {
  const flow = resultsRef?.current?.pipes?.[pipeName]?.flow;
  return flow != null && Math.abs(flow) > 0.001 ? "#1f78b4" : "#999";
}

function getOriginalStyle(feature, layer, resultsRef) {
  const geomType = feature.geometry && feature.geometry.type;
  if (geomType === "Point" || geomType === "MultiPoint") {
    return {
      radius: layer.options.radius,
      fillColor: layer.options.fillColor,
      color: "#232323",
      weight: 1,
      fillOpacity: 1,
    };
  }
  if (geomType === "LineString" || geomType === "MultiLineString") {
    const flow = resultsRef?.current?.pipes?.[feature.properties.name]?.flow;
    const hasFlow = flow != null && Math.abs(flow) > 0.001;
    return {
      color: hasFlow ? "#1f78b4" : "#999",
      weight: sizeToPipeWeight(feature.properties.size || 48),
      opacity: 0.9,
      dashArray: hasFlow ? "10 10" : null,
    };
  }
  // Polygon / MultiPolygon — check if this is an active overflow
  const ovName = feature.properties?.name;
  const isActiveOverflow =
    ovName && resultsRef?.current?.overflow?.[ovName]?.active;
  if (isActiveOverflow) {
    return {
      fillColor: "#e74c3c",
      fillOpacity: 0.6,
      color: "#c0392b",
      weight: 2,
    };
  }
  return {
    color: "#232323",
    weight: 1,
    fillColor: "#a6cde3",
    fillOpacity: 0.5,
  };
}

function addHoverHighlight(feature, layer, resultsRef) {
  layer.on({
    mouseover: () => {
      const savedStyle = getOriginalStyle(feature, layer, resultsRef);
      // Always clear any previously highlighted layer first
      if (_highlightedLayer && _highlightedLayer !== layer) {
        _clearHighlight();
      }
      if (layer.setStyle) {
        layer.setStyle({
          weight: (savedStyle.weight || 1) + 2,
          color: "#ffff00",
          fillColor: "#ffff00",
          fillOpacity: Math.min((savedStyle.fillOpacity || 0.5) + 0.3, 1),
          dashArray: null,
        });
        const geomType = feature.geometry && feature.geometry.type;
        if (
          geomType === "LineString" ||
          geomType === "MultiLineString" ||
          geomType === "Polygon" ||
          geomType === "MultiPolygon"
        ) {
          if (layer.bringToFront) layer.bringToFront();
        }
      }
      _highlightedLayer = layer;
      _highlightedSavedStyle = savedStyle;
    },
    mouseout: () => {
      if (_highlightedLayer === layer) {
        _clearHighlight();
      } else if (layer.setStyle) {
        layer.setStyle(getOriginalStyle(feature, layer, resultsRef));
      }
    },
    popupclose: () => {
      if (layer.setStyle) {
        layer.setStyle(getOriginalStyle(feature, layer, resultsRef));
      }
      if (_highlightedLayer === layer) {
        _highlightedLayer = null;
        _highlightedSavedStyle = null;
      }
    },
  });
}

function makeOnEachFeature(PopupComponent, resultsRef, extraRefsOrNull) {
  return (feature, layer) => {
    if (feature.properties) {
      // Create a container div and a React root for this popup.
      // On popupopen, render the React component into it;
      // on popupclose, unmount to avoid leaks.
      const container = document.createElement("div");
      let root = null;
      const popup = L.popup({
        className: "styled-popup",
        maxWidth: 350,
        closeOnClick: true,
        autoPan: true,
        autoPanPadding: L.point(50, 50),
      });
      popup.setContent(container);
      layer.bindPopup(popup);

      const renderPopup = () => {
        if (!root) root = createRoot(container);
        const extraProps = {};
        if (extraRefsOrNull) {
          const name = feature.properties.name;
          if (extraRefsOrNull.elevOverridesRef)
            extraProps.elevOverride =
              extraRefsOrNull.elevOverridesRef.current?.[name];
          if (extraRefsOrNull.onElevOverrideChangeRef)
            extraProps.onElevChange = (elev) =>
              extraRefsOrNull.onElevOverrideChangeRef.current?.(name, elev);
        }
        root.render(
          <PopupComponent
            properties={feature.properties}
            results={resultsRef.current}
            {...extraProps}
          />,
        );
      };

      // Store render function on layer so we can re-render open popups
      layer._renderPopup = renderPopup;
      layer._popupOpen = false;

      layer.on("popupopen", (e) => {
        layer._popupOpen = true;
        renderPopup();

        /* ── Smart popup positioning ──────────────────────────
           If the clicked element is in the upper half of the map
           container, flip the popup to open downward so it doesn't
           fall off the top. The map will still autoPan if needed. */
        const map = e.target._map || e.target._mapToAdd;
        if (!map) return;
        const latlng = popup.getLatLng();
        if (!latlng) return;
        const pt = map.latLngToContainerPoint(latlng);
        const containerH = map.getSize().y;
        const inUpperHalf = pt.y < containerH / 2;

        if (inUpperHalf) {
          // Flip popup to open downward via CSS + offset
          const wrapper = popup.getElement();
          if (wrapper) {
            wrapper.classList.add("leaflet-popup--below");
            // Leaflet internally positions the popup at:
            //   layerPt + [0, -container.offsetHeight] + offset
            // To flip it below the anchor, offset Y = container height.
            const totalH = wrapper.offsetHeight || 0;
            popup.options.offset = L.point(0, totalH);
            popup.update();
            // Re-trigger autoPan after repositioning
            if (popup.options.autoPan) {
              popup._adjustPan();
            }
          }
        } else {
          // Normal upward popup — ensure defaults
          const wrapper = popup.getElement();
          if (wrapper) {
            wrapper.classList.remove("leaflet-popup--below");
          }
          popup.options.offset = L.point(0, 7);
          popup.update();
        }
      });
      layer.on("popupclose", () => {
        layer._popupOpen = false;
        // Reset popup offset to default
        popup.options.offset = L.point(0, 7);
        const wrapper = popup.getElement();
        if (wrapper) {
          wrapper.classList.remove("leaflet-popup--below");
        }
        if (root) {
          root.unmount();
          root = null;
        }
      });
    }
    addHoverHighlight(feature, layer, resultsRef);
  };
}

/* ---- auto-fit bounds (runs once on mount) ---- */
function FitBounds({ data }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    const group = L.geoJSON(data);
    const bounds = group.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20], animate: false });
      fitted.current = true;
    }
  }, [map, data]);
  return null;
}

/* ---- map-level safety net for highlight cleanup ---- */
// When bringToFront() reorders SVG elements during mouseover, the browser
// may miss the corresponding mouseout event, leaving a layer highlighted.
// This component checks on every mousemove whether the highlighted layer's
// DOM element is still under the cursor and clears the highlight if not.
function HighlightCleanup() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();

    const onMapMouseMove = (e) => {
      if (!_highlightedLayer) return;
      const highlightEl = _highlightedLayer.getElement?.();
      if (!highlightEl) return;
      const target = e.originalEvent?.target;
      if (target && target !== highlightEl) {
        _clearHighlight();
      }
    };

    // Mouse left the map container entirely – clear any lingering highlight
    const onContainerLeave = () => {
      if (_highlightedLayer) {
        _clearHighlight();
      }
    };

    map.on("mousemove", onMapMouseMove);
    container.addEventListener("mouseleave", onContainerLeave);

    return () => {
      map.off("mousemove", onMapMouseMove);
      container.removeEventListener("mouseleave", onContainerLeave);
    };
  }, [map]);
  return null;
}

/* ---- create custom panes for z-index control ---- */
function CreatePanes() {
  const map = useMap();
  // Create panes synchronously so they exist before GeoJSON renders
  if (!map.getPane("polygonsPane")) {
    map.createPane("polygonsPane").style.zIndex = 401;
  }
  if (!map.getPane("pipesPane")) {
    map.createPane("pipesPane").style.zIndex = 402;
  }
  if (!map.getPane("pointsPane")) {
    map.createPane("pointsPane").style.zIndex = 403;
  }
  return null;
}

export default function MapPanel({
  hydraulicResults,
  valveOverrides,
  onValveOverrideChange,
  elevOverrides,
  onElevOverrideChange,
  viewMode = "2d-geo",
  layerVis,
}) {
  const r = hydraulicResults;
  const isSchematic = viewMode === "2d-sch";

  // Select coordinate-appropriate data source
  const activeNodes = isSchematic ? nodesSch : nodes;
  const activePipes = isSchematic ? pipesSch : pipes;
  const activeValves = isSchematic ? valvesSch : valves;
  const activeReservoirs = isSchematic ? reservoirsSch : reservoirs;
  const activeOverflow = isSchematic ? overflowSch : overflow;

  // Keep a ref to the latest results so lazily-opened popups always
  // show current data without forcing GeoJSON layers to remount.
  const resultsRef = useRef(r);
  resultsRef.current = r;

  // Refs for elevation overrides so imperative popups can access current values
  const elevOverridesRef = useRef(elevOverrides);
  elevOverridesRef.current = elevOverrides;
  const onElevOverrideChangeRef = useRef(onElevOverrideChange);
  onElevOverrideChangeRef.current = onElevOverrideChange;

  const pipeLayerRef = useRef(null);
  const resLayerRef = useRef(null);
  const ovfLayerRef = useRef(null);
  const [pipeLayerReady, setPipeLayerReady] = useState(false);

  // Reset pipe layer readiness when the map remounts (view mode change)
  // so the animation useEffect re-triggers once the new GeoJSON layer mounts.
  useEffect(() => {
    pipeLayerRef.current = null;
    setPipeLayerReady(false);
  }, [viewMode]);

  // Callback ref: when the GeoJSON pipe layer mounts, flag it ready
  // so the animation useEffect re-fires with actual sublayers present.
  const pipeLayerCallbackRef = useCallback((node) => {
    pipeLayerRef.current = node;
    if (node) {
      setPipeLayerReady(true);
    }
  }, []);

  // Build a name→[x,y] coordinate lookup for every pipe endpoint
  // (nodes, valves, reservoir/overflow centroids) so we can determine
  // whether a pipe's GeoJSON coordinates run us_node→ds_node or vice-versa.
  const nodeCoordMap = useMemo(() => {
    const m = new Map();
    // Point features: nodes and valves
    for (const fc of [activeNodes, activeValves]) {
      if (!fc?.features) continue;
      for (const f of fc.features) {
        const name = f.properties?.name;
        const c = f.geometry?.coordinates;
        if (name && c) m.set(name, c);
      }
    }
    // Polygon features: reservoirs and overflow — use ring centroid
    for (const fc of [activeReservoirs, activeOverflow]) {
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
  }, [activeNodes, activeValves, activeReservoirs, activeOverflow]);

  // Stable extra-refs object for reservoir/overflow popups
  const elevExtraRefs = useMemo(
    () => ({
      elevOverridesRef,
      onElevOverrideChangeRef,
    }),
    [],
  );

  // Memoize onEachFeature callbacks so they are stable across re-renders.
  // They read from resultsRef (always current) so they don't need to change.
  const onEachNode = useMemo(
    () => makeOnEachFeature(NodePopup, resultsRef),
    [],
  );
  const onEachPipe = useMemo(
    () => makeOnEachFeature(PipePopup, resultsRef),
    [],
  );
  const onEachReservoir = useMemo(
    () => makeOnEachFeature(ReservoirPopup, resultsRef, elevExtraRefs),
    [],
  );
  const onEachOverflow = useMemo(
    () => makeOnEachFeature(OverflowPopup, resultsRef, elevExtraRefs),
    [],
  );

  // Re-render any open reservoir/overflow popups when results or overrides change
  useEffect(() => {
    const rerender = (layerRef) => {
      const lg = layerRef.current;
      if (!lg) return;
      lg.eachLayer?.((layer) => {
        if (layer._popupOpen && layer._renderPopup) layer._renderPopup();
      });
    };
    rerender(resLayerRef);
    rerender(ovfLayerRef);
  }, [hydraulicResults, elevOverrides]);

  // Stable pipe style function that reads from resultsRef so it always
  // returns the correct colour, even when react-leaflet re-applies styles
  // due to unrelated re-renders (e.g. layer toggle).
  const pipeStyleFn = useCallback((feature) => {
    const flow = resultsRef.current?.pipes?.[feature.properties.name]?.flow;
    const hasFlow = flow != null && Math.abs(flow) > 0.001;
    return {
      color: hasFlow ? "#1f78b4" : "#999",
      weight: sizeToPipeWeight(feature.properties.size || 48),
      opacity: 0.9,
      pane: "pipesPane",
      dashArray: hasFlow ? "10 10" : null,
    };
  }, []);

  // When hydraulicResults change, imperatively re-style every pipe layer
  // so colours and ant-trail animation update immediately.
  // Pause animation during zoom to prevent flicker (especially in CRS.Simple).
  useEffect(() => {
    const group = pipeLayerRef.current;
    if (!r || !group) return;

    // Get the Leaflet map instance from the group's parent
    const map = group._map || group._mapToAdd;

    // Compute max flow for animation speed scaling
    let maxFlow = 1;
    if (r.pipes) {
      for (const p of Object.values(r.pipes)) {
        const af = Math.abs(p.flow || 0);
        if (af > maxFlow) maxFlow = af;
      }
    }

    // Build per-layer flow metadata for the animation loop
    const layerFlowMap = new Map();
    group.eachLayer((layer) => {
      if (layer.feature && layer.feature.properties?.name) {
        const props = layer.feature.properties;
        const pipeData = r.pipes?.[props.name];
        const flow = pipeData?.flow || 0;
        const absFlow = Math.abs(flow);
        const hasFlow = absFlow > 0.001;
        const color = hasFlow ? "#1f78b4" : "#999";

        if (hasFlow) {
          // Determine animation direction from EPANET hydraulic results.
          // flow > 0 → water travels us_node → ds_node.
          // We compare the first GeoJSON coordinate with the us_node
          // location to find whether the line is drawn us→ds or ds→us,
          // then set `sign` so the dash animation follows the flow.
          const coords = layer.feature.geometry?.coordinates;
          let first, last;
          if (coords) {
            const ring = Array.isArray(coords[0]?.[0]) ? coords[0] : coords;
            first = ring[0];
            last = ring[ring.length - 1];
          }

          const usNode = props.us_node;
          const dsNode = props.ds_node;
          const usCoord = nodeCoordMap.get(usNode);
          const dsCoord = nodeCoordMap.get(dsNode);

          // Determine whether GeoJSON coords run us→ds or ds→us.
          // Compare both endpoints to handle short pipes near large
          // polygons (reservoir centroids far from pipe ends) and
          // missing node coordinates.
          let coordsGoUsToDs = true;
          if (first && last && usCoord && dsCoord) {
            const sumNormal =
              Math.hypot(first[0] - usCoord[0], first[1] - usCoord[1]) +
              Math.hypot(last[0] - dsCoord[0], last[1] - dsCoord[1]);
            const sumFlipped =
              Math.hypot(first[0] - dsCoord[0], first[1] - dsCoord[1]) +
              Math.hypot(last[0] - usCoord[0], last[1] - usCoord[1]);
            coordsGoUsToDs = sumNormal <= sumFlipped;
          } else if (first && last && usCoord) {
            coordsGoUsToDs =
              Math.hypot(first[0] - usCoord[0], first[1] - usCoord[1]) <=
              Math.hypot(last[0] - usCoord[0], last[1] - usCoord[1]);
          } else if (first && last && dsCoord) {
            coordsGoUsToDs =
              Math.hypot(last[0] - dsCoord[0], last[1] - dsCoord[1]) <=
              Math.hypot(first[0] - dsCoord[0], first[1] - dsCoord[1]);
          }

          // sign = -1 → dashes move first→last (forward along path)
          // sign =  1 → dashes move last→first (backward along path)
          const flowGoesUsToDs = flow > 0;
          let sign = flowGoesUsToDs === coordsGoUsToDs ? -1 : 1;

          const speed = 7.5 + (absFlow / maxFlow) * 52.5;
          // Start solid; dash pattern enabled after initial render settles
          layer.setStyle({ color, dashArray: null, dashOffset: null });
          layerFlowMap.set(layer, { speed, sign, color });
        } else {
          layer.setStyle({ color, dashArray: null, dashOffset: null });
          layerFlowMap.delete(layer);
        }
      }
    });

    // Animation loop: update dashOffset each frame
    let prevTime = performance.now();
    let offsets = new Map();
    for (const [layer] of layerFlowMap) {
      offsets.set(layer, 0);
    }

    let zooming = false;
    let dashesEnabled = false;
    let rafId;
    let startTimerId;
    function animate(now) {
      const dt = (now - prevTime) / 1000;
      prevTime = now;
      if (!zooming) {
        for (const [layer, meta] of layerFlowMap) {
          let offset = (offsets.get(layer) || 0) + meta.speed * meta.sign * dt;
          offset = ((offset % 20) + 20) % 20;
          offsets.set(layer, offset);
          // Store on layer.options so Leaflet's _updateStyle preserves it
          // after zoom redraws (prevents single-frame flicker to offset 0).
          layer.options.dashOffset = String(offset);
          const el = layer.getElement?.();
          if (el) {
            el.setAttribute("stroke-dashoffset", offset);
          }
        }
      }
      rafId = requestAnimationFrame(animate);
    }

    const onZoomStart = () => {
      zooming = true;
      if (!dashesEnabled) return;
      // Temporarily remove dash patterns during zoom animation
      // so the SVG transform doesn't cause visual dash-jumping flicker.
      for (const [layer, meta] of layerFlowMap) {
        const el = layer.getElement?.();
        if (el) {
          el.setAttribute("stroke-dasharray", "none");
          el.removeAttribute("stroke-dashoffset");
        }
      }
    };
    const onZoomEnd = () => {
      if (!dashesEnabled) {
        zooming = false;
        return;
      }
      // Leaflet redraws paths at zoomend via _updateStyle.
      // Wait one frame for Leaflet's redraw to complete, then restore
      // dash patterns and reapply offsets.
      requestAnimationFrame(() => {
        for (const [layer, meta] of layerFlowMap) {
          const cur = offsets.get(layer);
          layer.options.dashArray = "10 10";
          if (cur != null) layer.options.dashOffset = String(cur);
          const el = layer.getElement?.();
          if (el) {
            el.setAttribute("stroke-dasharray", "10 10");
            if (cur != null) el.setAttribute("stroke-dashoffset", cur);
          }
        }
        zooming = false;
        prevTime = performance.now();
      });
    };

    if (map) {
      map.on("zoomstart", onZoomStart);
      map.on("zoomend", onZoomEnd);
    }

    // Delay enabling dash patterns until the map has fully settled
    // from initial render / fitBounds to prevent first-load flicker.
    if (layerFlowMap.size > 0) {
      startTimerId = setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            for (const [layer] of layerFlowMap) {
              layer.options.dashArray = "10 10";
              layer.options.dashOffset = "0";
              const el = layer.getElement?.();
              if (el) {
                el.setAttribute("stroke-dasharray", "10 10");
                el.setAttribute("stroke-dashoffset", "0");
              }
            }
            dashesEnabled = true;
            prevTime = performance.now();
            rafId = requestAnimationFrame(animate);
          });
        });
      }, 200);
    }

    return () => {
      if (startTimerId) clearTimeout(startTimerId);
      if (rafId) cancelAnimationFrame(rafId);
      if (map) {
        map.off("zoomstart", onZoomStart);
        map.off("zoomend", onZoomEnd);
      }
    };
  }, [r, pipeLayerReady, viewMode, nodeCoordMap]);

  // Combine all data for bounds calculation
  const allData = {
    type: "FeatureCollection",
    features: [
      ...activeReservoirs.features,
      ...activeOverflow.features,
      ...activePipes.features,
      ...activeNodes.features,
      ...activeValves.features,
    ],
  };

  return (
    <MapContainer
      key={viewMode}
      {...(isSchematic ? { crs: L.CRS.Simple, minZoom: 2 } : {})}
      center={isSchematic ? [5, 13.5] : [37.81, -120.29]}
      zoom={isSchematic ? 3 : 19}
      maxZoom={isSchematic ? 10 : 23}
      style={{
        width: "100%",
        height: "100%",
        background: isSchematic ? "#f0f2f5" : undefined,
      }}
      scrollWheelZoom={true}
      attributionControl={false}
      preferCanvas={false}
    >
      {!isSchematic && layerVis.basemap && (
        <TileLayer
          url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
          attribution=""
          maxZoom={23}
          maxNativeZoom={19}
        />
      )}

      <FitBounds data={allData} />
      <CreatePanes />
      <HighlightCleanup />

      {/* Polygons (bottom layer) – stable keys so layers never remount */}
      {layerVis.reservoirs && (
        <GeoJSON
          key="res"
          ref={resLayerRef}
          data={activeReservoirs}
          style={() => ({ ...polygonStyle("#a6cde3")(), pane: "polygonsPane" })}
          onEachFeature={onEachReservoir}
        />
      )}
      {layerVis.overflow && (
        <GeoJSON
          key="ovf"
          ref={ovfLayerRef}
          data={activeOverflow}
          style={() => ({
            ...polygonStyle("#a6cde3")(),
            pane: "polygonsPane",
            ...(r?.overflow?.overflow?.active ?
              {
                fillColor: "#e74c3c",
                fillOpacity: 0.6,
                color: "#c0392b",
                weight: 2,
              }
            : {}),
          })}
          onEachFeature={onEachOverflow}
        />
      )}

      {/* Polylines */}
      {layerVis.pipes && (
        <GeoJSON
          ref={pipeLayerCallbackRef}
          key="pip"
          data={activePipes}
          style={pipeStyleFn}
          onEachFeature={onEachPipe}
        />
      )}

      {/* Points */}
      {layerVis.nodes && (
        <GeoJSON
          key="nod"
          data={activeNodes}
          pointToLayer={pointToLayer("#000000", "pointsPane")}
          onEachFeature={onEachNode}
        />
      )}

      {/* Valve points */}
      {layerVis.valves &&
        activeValves.features.map((feature) => {
          const coords = feature.geometry.coordinates;
          const vName = feature.properties.name;
          const vType = feature.properties.type;
          const vStatus = feature.properties.status;
          const radius = sizeToValveRadius(feature.properties.size || 48);

          // Compute fill color from butterfly mode / gate+sluice status
          let fillColor = "#1f78b4";
          const ov = valveOverrides?.[vName];
          if (vType === "butterfly") {
            let mode = ov?.mode;
            if (!mode) {
              const isOpen =
                ov?.status === "open" ||
                (!ov?.status && String(vStatus) === "1");
              mode =
                !isOpen ? "closed"
                : (ov?.setting ?? 0) !== 0 ? "throttled"
                : "open";
            }
            if (mode === "throttled") fillColor = "#e6a817";
            else if (mode === "closed") fillColor = "#c0392b";
          } else {
            // gate, sluice, etc. – red when closed
            const isOpen =
              ov?.status === "open" || (!ov?.status && String(vStatus) === "1");
            if (!isOpen) fillColor = "#c0392b";
          }

          const defaultStyle = {
            fillColor,
            color: "#232323",
            weight: 1,
            fillOpacity: 1,
          };
          const highlightStyle = {
            weight: 3,
            color: "#ffff00",
            fillColor: "#ffff00",
            fillOpacity: 1,
          };
          return (
            <CircleMarker
              key={vName}
              center={[coords[1], coords[0]]}
              radius={radius}
              pathOptions={defaultStyle}
              pane="pointsPane"
              eventHandlers={{
                mouseover: (e) => {
                  _clearHighlight();
                  _highlightedSavedStyle = { radius, ...defaultStyle };
                  e.target.setStyle(highlightStyle);
                  _highlightedLayer = e.target;
                },
                mouseout: (e) => {
                  if (_highlightedLayer === e.target) {
                    _clearHighlight();
                  } else {
                    e.target.setStyle(defaultStyle);
                  }
                },
                popupopen: (e) => {
                  const popup = e.popup;
                  // Always position the popup at the valve center,
                  // not wherever the user happened to click on the circle.
                  popup.setLatLng([coords[1], coords[0]]);
                  // After the initial layout, lock the popup position so
                  // content re-renders (slider changes, model re-runs)
                  // cannot trigger Leaflet's _updateLayout and shift it.
                  if (popup && !popup._origUpdateLayout) {
                    popup._origUpdateLayout = popup._updateLayout.bind(popup);
                  }
                  requestAnimationFrame(() => {
                    if (popup) popup._updateLayout = () => {};
                  });

                  /* ── Smart popup positioning (same logic as GeoJSON layers) ── */
                  const map = e.target._map;
                  if (map && popup.getLatLng()) {
                    const pt = map.latLngToContainerPoint(popup.getLatLng());
                    const containerH = map.getSize().y;
                    const inUpperHalf = pt.y < containerH / 2;
                    const wrapper = popup.getElement();
                    if (inUpperHalf && wrapper) {
                      wrapper.classList.add("leaflet-popup--below");
                      const totalH = wrapper.offsetHeight || 0;
                      popup.options.offset = L.point(0, totalH);
                      popup.update();
                      if (popup.options.autoPan) popup._adjustPan();
                    } else if (wrapper) {
                      wrapper.classList.remove("leaflet-popup--below");
                      popup.options.offset = L.point(0, 7);
                      popup.update();
                    }
                  }
                },
                popupclose: (e) => {
                  // Restore _updateLayout so the next open re-positions correctly
                  const popup = e.popup;
                  if (popup && popup._origUpdateLayout) {
                    popup._updateLayout = popup._origUpdateLayout;
                  }
                  // Reset popup offset and flip class
                  popup.options.offset = L.point(0, 7);
                  const wrapper = popup.getElement();
                  if (wrapper) {
                    wrapper.classList.remove("leaflet-popup--below");
                  }
                  e.target.setStyle(defaultStyle);
                  if (_highlightedLayer === e.target) {
                    _highlightedLayer = null;
                    _highlightedSavedStyle = null;
                  }
                },
              }}
            >
              <Popup
                className="styled-popup"
                maxWidth={320}
                autoPan={true}
                autoPanPadding={[50, 50]}
              >
                <ValvePopup
                  properties={feature.properties}
                  results={r}
                  overrides={valveOverrides?.[vName]}
                  onOverrideChange={(o) => onValveOverrideChange?.(vName, o)}
                />
              </Popup>
            </CircleMarker>
          );
        })}
    </MapContainer>
  );
}
