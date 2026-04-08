import nodesRaw from "../data/nodes.json";
import pipesRaw from "../data/pipes.json";
import valvesRaw from "../data/valves.json";
import reservoirsRaw from "../data/reservoirs.json";
import overflowRaw from "../data/overflow.json";

/**
 * Convert our custom JSON format into standard GeoJSON FeatureCollections.
 * @param {string} coordKey - "geographic" (lng/lat) or "schematic" (x/y grid)
 */
function toGeoJSON(items, coordKey = "geographic") {
  return {
    type: "FeatureCollection",
    features: items.map((item) => ({
      type: "Feature",
      properties: { ...item.properties },
      geometry: {
        type: item.geometry.type,
        coordinates: item.geometry[coordKey],
      },
    })),
  };
}

/* Geographic (2D-GEO) */
export const nodes = toGeoJSON(nodesRaw, "geographic");
export const pipes = toGeoJSON(pipesRaw, "geographic");
export const valves = toGeoJSON(valvesRaw, "geographic");
export const reservoirs = toGeoJSON(reservoirsRaw, "geographic");
export const overflow = toGeoJSON(overflowRaw, "geographic");

/* Schematic (2D-SCH) */
export const nodesSch = toGeoJSON(nodesRaw, "schematic");
export const pipesSch = toGeoJSON(pipesRaw, "schematic");
export const valvesSch = toGeoJSON(valvesRaw, "schematic");
export const reservoirsSch = toGeoJSON(reservoirsRaw, "schematic");
export const overflowSch = toGeoJSON(overflowRaw, "schematic");
