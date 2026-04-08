import {
  Project,
  Workspace,
  NodeType,
  LinkType,
  NodeProperty,
  LinkProperty,
  FlowUnits,
  HeadLossType,
  InitHydOption,
  LinkStatusType,
  CountType,
} from "epanet-js";

import nodesRaw from "../data/nodes.json";
import pipesRaw from "../data/pipes.json";
import valvesRaw from "../data/valves.json";
import reservoirsRaw from "../data/reservoirs.json";
import overflowRaw from "../data/overflow.json";

/**
 * Build an EPANET hydraulic model from the JSON data and solve it.
 *
 * Returns an object:
 *   { nodes: { [name]: { pressure, head, demand } },
 *     pipes: { [name]: { flow, velocity, headloss, status } },
 *     valves: { [name]: { flow, velocity, headloss, status } } }
 */
export async function runHydraulicModel(
  valveOverrides = {},
  elevOverrides = {},
) {
  // ── Initialise EPANET workspace & project ──────────────────────────
  const ws = new Workspace();
  await ws.loadModule();
  const model = new Project(ws);

  // MGD ⟹ US customary units; Hazen-Williams head-loss formula
  model.init("report.rpt", "out.bin", FlowUnits.MGD, HeadLossType.HW);

  // ── Build lookup maps ──────────────────────────────────────────────
  const valveMap = new Map();
  for (const v of valvesRaw) valveMap.set(v.properties.name, v.properties);

  const nodeMap = new Map();
  for (const n of nodesRaw) nodeMap.set(n.properties.name, n.properties);

  const reservoirMap = new Map();
  for (const r of reservoirsRaw)
    reservoirMap.set(r.properties.name, r.properties);

  const overflowMap = new Map();
  for (const o of overflowRaw) overflowMap.set(o.properties.name, o.properties);

  // ── Determine which valves are referenced by pipe endpoints ────────
  const pipeRefs = new Set();
  for (const p of pipesRaw) {
    pipeRefs.add(p.properties.us_node);
    pipeRefs.add(p.properties.ds_node);
  }

  const referencedValves = new Set();
  for (const vName of valveMap.keys()) {
    if (pipeRefs.has(vName)) referencedValves.add(vName);
  }

  // Track pipe names so we can detect pipe/valve name collisions
  const pipeNames = new Set();
  for (const p of pipesRaw) pipeNames.add(p.properties.name);

  // Track names already added as reservoir nodes (avoid duplicates)
  const addedNodeNames = new Set();

  // ── 1. Add RESERVOIR nodes (fixed-head boundaries) ─────────────────
  //    Only add reservoirs that are actually referenced by pipe endpoints
  for (const [name, props] of reservoirMap) {
    if (!pipeRefs.has(name)) continue;
    const idx = model.addNode(name, NodeType.Reservoir);
    const resElev = elevOverrides[name] ?? props.elev;
    model.setNodeValue(idx, NodeProperty.Elevation, resElev);
    addedNodeNames.add(name);
  }

  // ── 1b. Connect Priest Reservoir to priest_inlet_001 ──────────────
  //    Priest Reservoir (elev 2204) is the upstream fixed-head source
  //    but has no pipe in the data. Add it as a reservoir and connect
  //    it with a short pipe to the first intake node.
  if (
    reservoirMap.has("Priest Reservoir") &&
    !addedNodeNames.has("Priest_Reservoir")
  ) {
    const prProps = reservoirMap.get("Priest Reservoir");
    const prIdx = model.addNode("Priest_Reservoir", NodeType.Reservoir);
    const prElev = elevOverrides["Priest Reservoir"] ?? prProps.elev;
    model.setNodeValue(prIdx, NodeProperty.Elevation, prElev);
    addedNodeNames.add("Priest_Reservoir");
  }

  // ── 2. Add OVERFLOW SHAFT as a reservoir ───────────────────────────
  //    The overflow polygon represents the overflow weir / shaft structure.
  //    It is modeled as a fixed-head reservoir named "<name>_shaft" at the
  //    weir crest elevation.  A check-valve pipe from the "overflow" junction
  //    to the shaft node allows water to spill only when head exceeds the
  //    crest elevation.
  for (const [name, props] of overflowMap) {
    const shaftName = name + "_shaft";
    const idx = model.addNode(shaftName, NodeType.Reservoir);
    const ovfElev = elevOverrides[name] ?? props.elev;
    model.setNodeValue(idx, NodeProperty.Elevation, ovfElev);
    addedNodeNames.add(shaftName);
    // Do NOT add to addedNodeNames with the original name, so the
    // "overflow" junction from nodesRaw gets added in section 3.
  }

  // ── 3. Add JUNCTION nodes ──────────────────────────────────────────
  for (const [name, props] of nodeMap) {
    if (addedNodeNames.has(name)) continue; // already added as reservoir
    const idx = model.addNode(name, NodeType.Junction);
    model.setJunctionData(idx, props.elev, 0, "");
    addedNodeNames.add(name);
  }

  // ── 4. Add missing node referenced by pipes but absent from data ───
  //    priest_inlet_002 : downstream end of sluice gate pipes
  if (!nodeMap.has("priest_inlet_002") && pipeRefs.has("priest_inlet_002")) {
    const idx = model.addNode("priest_inlet_002", NodeType.Junction);
    // Use same elevation as priest_inlet_001 (2150 ft)
    model.setJunctionData(idx, 2150, 0, "");
  }

  // ── 5. Create PSEUDONODES + TCV links for referenced valves ────────
  //
  //  Each valve in the data is a point, but EPANET models valves as
  //  two-node links. For every valve referenced by a pipe endpoint we
  //  create:
  //    • {valve}_us   – upstream junction pseudonode
  //    • {valve}_ds   – downstream junction pseudonode
  //    • TCV link from _us → _ds  (named "v_{valve}" to avoid ID
  //      collisions with pipes that share the valve name)
  //
  //  Pipes whose us_node or ds_node equals a valve name are then
  //  re-pointed to the appropriate pseudonode.

  // Map: original valve name → EPANET link ID for that valve
  const valveLinkIdMap = new Map();

  for (const vName of referencedValves) {
    const vProps = valveMap.get(vName);
    const override = valveOverrides[vName];
    const usName = vName + "_us";
    const dsName = vName + "_ds";

    // Pseudonodes inherit the valve's elevation
    const usIdx = model.addNode(usName, NodeType.Junction);
    model.setJunctionData(usIdx, vProps.elev, 0, "");

    const dsIdx = model.addNode(dsName, NodeType.Junction);
    model.setJunctionData(dsIdx, vProps.elev, 0, "");

    // Valve EPANET link – prefix with "v_" to dodge pipe-name collisions
    const linkId = "v_" + vName;
    valveLinkIdMap.set(vName, linkId);

    // Determine EPANET valve type from user override (butterfly only)
    const isButterflyValve = vProps.type === "butterfly";
    const calcType = (isButterflyValve && override?.calcType) || "TCV";
    const epanetLinkType = calcType === "FCV" ? LinkType.FCV : LinkType.TCV;

    const linkIdx = model.addLink(linkId, epanetLinkType, usName, dsName);
    model.setLinkValue(linkIdx, LinkProperty.Diameter, vProps.size);

    // Determine open/closed status (override wins)
    let isOpen;
    if (override?.status != null) {
      isOpen = override.status === "open";
    } else {
      isOpen = String(vProps.status) === "1";
    }

    // Determine setting value (override wins)
    const settingValue = override?.setting ?? vProps.setting ?? 0;

    if (isOpen) {
      model.setLinkValue(linkIdx, LinkProperty.InitStatus, LinkStatusType.Open);
      model.setLinkValue(linkIdx, LinkProperty.InitSetting, settingValue);
    } else {
      model.setLinkValue(
        linkIdx,
        LinkProperty.InitStatus,
        LinkStatusType.Closed,
      );
    }
  }

  // ── 6. Add PIPE links ─────────────────────────────────────────────
  for (const p of pipesRaw) {
    const props = p.properties;
    let usNode = props.us_node;
    let dsNode = props.ds_node;

    // Skip self-loop pipes (e.g. priest_inlet_sluice_001_B)
    if (usNode === dsNode) continue;

    // Substitute valve references with pseudonodes
    if (referencedValves.has(dsNode)) {
      dsNode = dsNode + "_us"; // pipe feeds into valve's upstream side
    }
    if (referencedValves.has(usNode)) {
      usNode = usNode + "_ds"; // pipe draws from valve's downstream side
    }

    // Safety: skip if substitution produced a self-loop
    if (usNode === dsNode) continue;

    const linkIdx = model.addLink(props.name, LinkType.Pipe, usNode, dsNode);
    model.setPipeData(linkIdx, props.length, props.size, 130, 0);
  }

  // ── 6b. Add overflow check-valve pipe ─────────────────────────────
  //    CVPipe (LinkType 0) allows flow only from start→end node.
  //    Flow occurs when head at "overflow" junction exceeds the shaft
  //    reservoir elevation (the weir crest).
  for (const [name, props] of overflowMap) {
    const shaftName = name + "_shaft";
    const cvPipeName = name + "_cv";
    const linkIdx = model.addLink(
      cvPipeName,
      LinkType.CVPipe,
      name, // start node: the overflow junction
      shaftName, // end node: the overflow shaft reservoir
    );
    // Short connecting pipe: 10 ft, 120-in diameter, C=130
    model.setPipeData(linkIdx, 10, 120, 130, 0);
  }

  // ── 6c. Connect Priest Reservoir to priest_inlet_002 ──────────────
  //    priest_inlet_002 feeds both sluice gate paths that lead to
  //    priest_inlet_001.
  if (addedNodeNames.has("Priest_Reservoir")) {
    const prPipeIdx = model.addLink(
      "priest_reservoir_intake",
      LinkType.Pipe,
      "Priest_Reservoir",
      "priest_inlet_002",
    );
    // Short intake pipe: 10 ft long, 120-in diameter, C=130
    model.setPipeData(prPipeIdx, 10, 120, 130, 0);
  }

  // ── 7. Solve steady-state hydraulics ──────────────────────────────
  model.solveH();

  // ── 8. Extract results ────────────────────────────────────────────
  const results = { nodes: {}, pipes: {}, valves: {}, overflow: {} };

  const nodeCount = model.getCount(CountType.NodeCount);
  for (let i = 1; i <= nodeCount; i++) {
    const id = model.getNodeId(i);
    results.nodes[id] = {
      pressure: model.getNodeValue(i, NodeProperty.Pressure),
      head: model.getNodeValue(i, NodeProperty.Head),
      demand: model.getNodeValue(i, NodeProperty.Demand),
    };
  }

  // Alias Priest_Reservoir → "Priest Reservoir" so the popup can find it
  // by the original GeoJSON feature name (which uses a space).
  if (results.nodes["Priest_Reservoir"]) {
    results.nodes["Priest Reservoir"] = results.nodes["Priest_Reservoir"];
  }

  // Accumulator for total absolute flow touching each node.
  // For a transit node (zero demand), throughflow = sumAbsFlow / 2.
  const nodeAbsFlow = {};

  const linkCount = model.getCount(CountType.LinkCount);
  for (let i = 1; i <= linkCount; i++) {
    const id = model.getLinkId(i);
    const flow = model.getLinkValue(i, LinkProperty.Flow);
    const linkResult = {
      flow,
      velocity: model.getLinkValue(i, LinkProperty.Velocity),
      headloss: model.getLinkValue(i, LinkProperty.Headloss),
      status: model.getLinkValue(i, LinkProperty.Status),
    };

    // Accumulate absolute flow at each endpoint node
    const { node1, node2 } = model.getLinkNodes(i);
    const n1Name = model.getNodeId(node1);
    const n2Name = model.getNodeId(node2);
    const absFlow = Math.abs(flow);
    nodeAbsFlow[n1Name] = (nodeAbsFlow[n1Name] || 0) + absFlow;
    nodeAbsFlow[n2Name] = (nodeAbsFlow[n2Name] || 0) + absFlow;

    // Valve links were prefixed with "v_" – map back to original name
    if (id.startsWith("v_")) {
      const origName = id.slice(2);
      if (referencedValves.has(origName)) {
        linkResult.us_head = model.getNodeValue(node1, NodeProperty.Head);
        linkResult.ds_head = model.getNodeValue(node2, NodeProperty.Head);
        linkResult.us_elev = model.getNodeValue(node1, NodeProperty.Elevation);
        linkResult.ds_elev = model.getNodeValue(node2, NodeProperty.Elevation);
        results.valves[origName] = linkResult;
        continue;
      }
    }

    // Enrich pipe results with endpoint head & elevation
    // node1 = upstream (start), node2 = downstream (end) in EPANET
    linkResult.us_head = model.getNodeValue(node1, NodeProperty.Head);
    linkResult.ds_head = model.getNodeValue(node2, NodeProperty.Head);
    linkResult.us_elev = model.getNodeValue(node1, NodeProperty.Elevation);
    linkResult.ds_elev = model.getNodeValue(node2, NodeProperty.Elevation);

    results.pipes[id] = linkResult;
  }

  // Store throughflow on each node (sum of abs connected flows / 2)
  for (const [id, nodeResult] of Object.entries(results.nodes)) {
    nodeResult.flow = (nodeAbsFlow[id] || 0) / 2;
  }

  model.close();

  // ── 9. Detect overflow conditions ─────────────────────────────────
  for (const [name] of overflowMap) {
    const cvPipeName = name + "_cv";
    const cvResult = results.pipes[cvPipeName];
    if (cvResult) {
      results.overflow[name] = {
        active: Math.abs(cvResult.flow) > 0.001,
        flow: cvResult.flow,
      };
    } else {
      results.overflow[name] = { active: false, flow: 0 };
    }
  }

  return results;
}
