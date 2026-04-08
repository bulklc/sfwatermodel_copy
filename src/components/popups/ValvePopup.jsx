import { useState, useEffect, useRef } from "react";
import "./PopupStyles.css";
import { fmtNum } from "../../utils/fmt.js";

/* ── Colour constants (consistent with Node/Pipe popups) ── */
const C_TOTAL = "#4A90D9"; // blue   – total head
const C_ELEV = "#95C13D"; // lime   – elevation
const C_PRES = "#F5B731"; // amber  – pressure head
const C_HLOSS = "#D94455"; // soft red – headloss across valve

/* Lighter downstream shades */
const C_TOTAL_DS = "#89BAE8"; // light blue
const C_ELEV_DS = "#BCD88D"; // light lime
const C_PRES_DS = "#F9D580"; // light amber

const BAR_OPACITY = 0.65;
const BAR_HOVER_OPACITY = 0.9;

function capitalize(str) {
  if (!str) return "—";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ── helpers ── */
function niceStep(range, targetTicks = 4) {
  const rough = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const res = rough / mag;
  if (res <= 1.5) return mag;
  if (res <= 3.5) return 2 * mag;
  if (res <= 7.5) return 5 * mag;
  return 10 * mag;
}

/* ── DetailRow (same layout as Pipe/Node popups) ───── */
function DetailRow({
  label,
  unit,
  value,
  textValue,
  computed = false,
  swatch = null,
  highlighted = false,
  decimals = 2,
  hoverKey = null,
  onHover = null,
  valueColor = null,
}) {
  const valColor = valueColor || (computed ? C_TOTAL : "#222");
  const rowStyle =
    highlighted ?
      {
        background: "#f0f6ff",
        transition: "background 0.15s",
        cursor: hoverKey ? "pointer" : undefined,
      }
    : {
        transition: "background 0.15s",
        cursor: hoverKey ? "pointer" : undefined,
      };
  const handlers =
    hoverKey && onHover ?
      {
        onMouseEnter: () => onHover(hoverKey),
        onMouseLeave: () => onHover(null),
      }
    : {};
  return (
    <tr style={rowStyle} {...handlers}>
      <td style={{ width: 22, paddingLeft: 4, paddingRight: 6 }}>
        {swatch ?
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: swatch,
              borderRadius: 2,
            }}
          />
        : null}
      </td>
      <td
        style={{
          fontWeight: 600,
          color: "#555",
          whiteSpace: "nowrap",
          padding: "2px 6px 2px 0",
        }}
      >
        {label}
      </td>
      <td
        style={{
          textAlign: "right",
          color: valColor,
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          padding: "2px 4px 2px 0",
        }}
      >
        {textValue != null ? textValue : fmtNum(value, decimals)}
      </td>
      <td
        style={{
          color: "#888",
          fontSize: 11,
          textTransform: "uppercase",
          padding: "2px 0 2px 2px",
          whiteSpace: "nowrap",
        }}
      >
        {unit}
      </td>
    </tr>
  );
}

/* ── Four-bar chart for valves ───────────────────────── */
function ValveBarChart({
  usElev,
  dsElev,
  usHead,
  dsHead,
  hovered,
  setHovered,
}) {
  const usPres = usHead - usElev;
  const dsPres = dsHead - dsElev;

  const usPresNeg = usPres < 0;
  const dsPresNeg = dsPres < 0;

  const W = 310;
  const H = 130;
  const padTop = 18;
  const padBot = 18;
  const padLeft = 14;
  const padRight = 52;
  const barW = 22;
  const barGap = 3;
  const chartH = H - padTop - padBot;

  const maxVal = 2500;
  const scale = (v) => (v / maxVal) * chartH;
  const baseY = padTop + chartH;

  const hasHeadloss = usHead > dsHead;

  /* Layout: 5 bars when headloss exists, 4 otherwise
     [DS_total | DS_stack | (headloss) | US_stack | US_total]  */
  const nBars = hasHeadloss ? 5 : 4;
  const groupW = nBars * barW + (nBars - 1) * barGap;
  const axisRight = W - padRight;
  const chartW = axisRight - padLeft;
  const startX = padLeft + (chartW - groupW) / 2;

  const xDS_total = startX;
  const xDS_stack = startX + (barW + barGap);
  const xHL = hasHeadloss ? startX + 2 * (barW + barGap) : null;
  const xUS_stack = startX + (hasHeadloss ? 3 : 2) * (barW + barGap);
  const xUS_total = startX + (hasHeadloss ? 4 : 3) * (barW + barGap);

  /* Dashed divider sits at the centre of the headloss bar (or midpoint of DS/US gap) */
  const dividerX = hasHeadloss ? xHL + barW / 2 : xDS_stack + barW + barGap / 2;

  const hUsElev = scale(usElev);
  const hUsPres = scale(Math.abs(usPres));
  const hDsElev = scale(dsElev);
  const hDsPres = scale(Math.abs(dsPres));
  const hUsHead = scale(Math.max(0, usHead));
  const hDsHead = scale(Math.max(0, dsHead));

  /* Y-axis ticks on right side */
  const step = niceStep(maxVal);
  const ticks = [];
  for (let v = 0; v <= maxVal; v += step) {
    const y = baseY - scale(v);
    ticks.push(
      <g key={v}>
        <line
          x1={axisRight}
          y1={y}
          x2={axisRight + 4}
          y2={y}
          stroke="#999"
          strokeWidth="1"
        />
        <text
          x={axisRight + 7}
          y={y + 3.5}
          textAnchor="start"
          fontSize="9"
          fill="#666"
        >
          {Math.round(v).toLocaleString()}
        </text>
      </g>,
    );
  }

  /* Elevation marker — dashed line across all bars at elevation level */
  const elevY = baseY - scale(usElev); // same elevation both sides

  const dsCX = (xDS_total + xDS_stack + barW) / 2;
  const usCX = (xUS_stack + xUS_total + barW) / 2;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={W}
      height={H}
      style={{ display: "block", margin: "4px auto 0" }}
    >
      {/* Axes */}
      <line
        x1={axisRight}
        y1={padTop}
        x2={axisRight}
        y2={baseY}
        stroke="#bbb"
        strokeWidth="1"
      />
      <line
        x1={padLeft}
        y1={baseY}
        x2={axisRight}
        y2={baseY}
        stroke="#bbb"
        strokeWidth="1"
      />
      {ticks}

      {/* DS bars */}
      <rect
        x={xDS_total}
        y={baseY - hDsHead}
        width={barW}
        height={hDsHead}
        fill={C_TOTAL_DS}
        fillOpacity={hovered === "ds_total" ? BAR_HOVER_OPACITY : BAR_OPACITY}
        rx="3"
        style={{
          cursor: "pointer",
          transition: "y 0.5s ease, height 0.5s ease, fill-opacity 0.15s",
        }}
        onMouseEnter={() => setHovered("ds_total")}
        onMouseLeave={() => setHovered(null)}
      />

      {/* Shared elevation bar — spans from DS stack to US stack across the middle */}
      <rect
        x={xDS_stack}
        y={baseY - hUsElev}
        width={xUS_stack + barW - xDS_stack}
        height={hUsElev}
        fill={C_ELEV}
        fillOpacity={
          hovered === "elev" || hovered === "us_elev" || hovered === "ds_elev" ?
            BAR_HOVER_OPACITY
          : BAR_OPACITY
        }
        rx="3"
        style={{
          cursor: "pointer",
          transition: "y 0.5s ease, height 0.5s ease, fill-opacity 0.15s",
        }}
        onMouseEnter={() => setHovered("elev")}
        onMouseLeave={() => setHovered(null)}
      />

      {/* DS pressure head (on top of elevation if positive, below if negative) */}
      <rect
        x={xDS_stack}
        y={dsPresNeg ? baseY - hDsElev : baseY - hDsElev - hDsPres}
        width={barW}
        height={hDsPres}
        fill={C_PRES_DS}
        fillOpacity={hovered === "ds_pres" ? BAR_HOVER_OPACITY : BAR_OPACITY}
        rx="3"
        style={{
          cursor: "pointer",
          transition: "y 0.5s ease, height 0.5s ease, fill-opacity 0.15s",
        }}
        onMouseEnter={() => setHovered("ds_pres")}
        onMouseLeave={() => setHovered(null)}
      />

      {/* Headloss bar — same width/spacing as other bars, between DS and US stacks */}
      {hasHeadloss && (
        <rect
          x={xHL}
          y={baseY - hUsHead}
          width={barW}
          height={hUsHead - hDsHead}
          fill={C_HLOSS}
          fillOpacity={hovered === "headloss" ? 0.55 : 0.35}
          rx="3"
          style={{
            cursor: "pointer",
            transition: "y 0.5s ease, height 0.5s ease, fill-opacity 0.15s",
          }}
          onMouseEnter={() => setHovered("headloss")}
          onMouseLeave={() => setHovered(null)}
        />
      )}

      {/* Vertical divider between DS and US — starts above elevation */}
      <line
        x1={dividerX}
        y1={padTop}
        x2={dividerX}
        y2={baseY - hUsElev}
        stroke="#999"
        strokeWidth="2"
        strokeDasharray="4 3"
        style={{ transition: "y2 0.5s ease" }}
      />

      {/* US pressure head (on top of elevation if positive, below if negative) */}
      <rect
        x={xUS_stack}
        y={usPresNeg ? baseY - hUsElev : baseY - hUsElev - hUsPres}
        width={barW}
        height={hUsPres}
        fill={C_PRES}
        fillOpacity={hovered === "us_pres" ? BAR_HOVER_OPACITY : BAR_OPACITY}
        rx="3"
        style={{
          cursor: "pointer",
          transition: "y 0.5s ease, height 0.5s ease, fill-opacity 0.15s",
        }}
        onMouseEnter={() => setHovered("us_pres")}
        onMouseLeave={() => setHovered(null)}
      />
      <rect
        x={xUS_total}
        y={baseY - hUsHead}
        width={barW}
        height={hUsHead}
        fill={C_TOTAL}
        fillOpacity={hovered === "us_total" ? BAR_HOVER_OPACITY : BAR_OPACITY}
        rx="3"
        style={{
          cursor: "pointer",
          transition: "y 0.5s ease, height 0.5s ease, fill-opacity 0.15s",
        }}
        onMouseEnter={() => setHovered("us_total")}
        onMouseLeave={() => setHovered(null)}
      />

      {/* Labels */}
      <text
        x={dsCX}
        y={baseY + 12}
        textAnchor="middle"
        fontSize="9"
        fill="#666"
        fontWeight="600"
      >
        DS
      </text>
      <text
        x={usCX}
        y={baseY + 12}
        textAnchor="middle"
        fontSize="9"
        fill="#666"
        fontWeight="600"
      >
        US
      </text>
    </svg>
  );
}

/**
 * Butterfly valve "mode" derived from overrides:
 *   "open"      – fully open, no throttle loss
 *   "throttled" – open with user-tuned loss/flow setting
 *   "closed"    – valve shut
 */
function deriveMode(overrides, srcStatus) {
  if (overrides?.mode) return overrides.mode;
  // Legacy / initial: map source data status
  const isOpen =
    overrides?.status === "open" ||
    (!overrides?.status && String(srcStatus) === "1");
  if (!isOpen) return "closed";
  // If a non-zero setting was previously configured, treat as throttled
  if ((overrides?.setting ?? 0) !== 0) return "throttled";
  return "open";
}

export default function ValvePopup({
  properties,
  results,
  overrides,
  onOverrideChange,
}) {
  const { name, size, type, setting, status, elev } = properties;

  const isButterfly = type === "butterfly";
  const isGate = type === "gate";
  const isSluice = type === "sluice";
  const isControllable = isButterfly || isGate || isSluice;

  /* ── Effective values: override wins over source data ─────────── */
  const butterflyMode = isButterfly ? deriveMode(overrides, status) : null;
  const effectiveCalcType = overrides?.calcType ?? "FCV";
  const effectiveSetting = overrides?.setting ?? setting ?? 0;
  const effectiveStatus =
    overrides?.status ?? (String(status) === "1" ? "open" : "closed");
  const isOpen =
    isButterfly ? butterflyMode !== "closed" : effectiveStatus === "open";

  /* ── Slider local state (visual feedback during drag) ────────── */
  const [localSetting, setLocalSetting] = useState(effectiveSetting);
  const settingRef = useRef(effectiveSetting);

  useEffect(() => {
    setLocalSetting(effectiveSetting);
    settingRef.current = effectiveSetting;
  }, [effectiveSetting]);

  const handleSliderChange = (e) => {
    const val = parseFloat(e.target.value);
    setLocalSetting(val);
    settingRef.current = val;
  };

  const commitSetting = () => {
    onOverrideChange?.({
      ...(overrides || {}),
      calcType: effectiveCalcType,
      setting: settingRef.current,
      mode: butterflyMode,
      status: "open",
    });
  };

  /* ── Butterfly three-way mode handler ────────────────────────── */
  const handleModeChange = (newMode) => {
    const next = { ...(overrides || {}), mode: newMode };

    /* When leaving throttled mode, stash the current throttle settings
       so they can be restored if the user switches back. */
    if (butterflyMode === "throttled" && newMode !== "throttled") {
      next._savedCalcType = effectiveCalcType;
      next._savedSetting = effectiveSetting;
    }

    if (newMode === "open") {
      next.status = "open";
      next.calcType = "TCV";
      next.setting = 0;
    } else if (newMode === "throttled") {
      next.status = "open";
      /* Restore previously-stashed throttle settings if available */
      next.calcType = next._savedCalcType || next.calcType || "TCV";
      next.setting = next._savedSetting ?? next.setting ?? 0;
    } else {
      next.status = "closed";
    }
    onOverrideChange?.(next);
  };

  /* ── Calc-type handler (butterfly throttled only) ────────────── */
  const handleCalcTypeChange = (newType) => {
    const prev = { ...(overrides || {}) };
    const oldType = prev.calcType || "FCV";
    /* Stash the current setting under its calc-type key */
    if (oldType === "FCV") prev._savedFCV = prev.setting ?? 0;
    else prev._savedTCV = prev.setting ?? 0;
    /* Restore saved setting for the target calc type (default 0) */
    const restored =
      newType === "FCV" ? (prev._savedFCV ?? 0) : (prev._savedTCV ?? 0);
    onOverrideChange?.({
      ...prev,
      calcType: newType,
      setting: restored,
      status: "open",
      mode: "throttled",
    });
  };

  /* ── Gate open/closed handler ────────────────────────────────── */
  const handleStatusChange = (newStatus) => {
    onOverrideChange?.({
      ...(overrides || {}),
      calcType: effectiveCalcType,
      setting: effectiveSetting,
      status: newStatus,
    });
  };

  /* ── Hydraulic results ───────────────────────────────────────── */
  const r = results?.valves?.[name];
  const [hovered, setHovered] = useState(null);

  /* Derived values */
  const usHead = r?.us_head;
  const dsHead = r?.ds_head;
  const usElev = r?.us_elev;
  const dsElev = r?.ds_elev;
  const usPres = usHead != null && usElev != null ? usHead - usElev : null;
  const dsPres = dsHead != null && dsElev != null ? dsHead - dsElev : null;

  /* ── Slider config ───────────────────────────────────────────── */
  const sliderMax = effectiveCalcType === "TCV" ? 500 : 1000;
  const sliderStep = effectiveCalcType === "TCV" ? 0.5 : 1;
  const sliderLabel =
    effectiveCalcType === "TCV" ? "Loss Coeff. (K)" : "Target Flow (MGD)";

  /* ── Three-way switch position index ─────────────────────────── */
  const triModes = ["open", "throttled", "closed"];
  const triLabels = ["Fully Open", "Throttled", "Fully Closed"];
  const triIndex = triModes.indexOf(butterflyMode ?? "open");
  const triColors = {
    open: "#1f78b4",
    throttled: "#e6a817",
    closed: "#c0392b",
  };
  const thumbColor = triColors[butterflyMode ?? "open"];

  return (
    <div className="popup-container">
      <div className="popup-header">{name}</div>

      {/* ── Butterfly: three-way slide switch ── */}
      {isButterfly && (
        <>
          <div className="valve-control-group">
            <div className="valve-control-label">Valve Position</div>
            <div className="tri-switch">
              <div
                className="tri-switch-track"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = (e.clientX - rect.left) / rect.width;
                  if (pct < 0.333) handleModeChange("open");
                  else if (pct < 0.667) handleModeChange("throttled");
                  else handleModeChange("closed");
                }}
              >
                <div
                  className="tri-switch-thumb"
                  style={{
                    left: `calc(${triIndex} * 33.333% + 1px)`,
                    background: thumbColor,
                  }}
                />
              </div>
              <div className="tri-switch-labels">
                {triModes.map((m, i) => (
                  <span
                    key={m}
                    className={`tri-switch-label${m === butterflyMode ? " tri-switch-label--active" : ""}`}
                    style={
                      m === butterflyMode ? { color: triColors[m] } : undefined
                    }
                    onClick={() => handleModeChange(m)}
                  >
                    {triLabels[i]}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Throttled sub-controls – always rendered for stable height,
              hidden via visibility when not in throttled mode */}
          <div
            style={{
              visibility: butterflyMode === "throttled" ? "visible" : "hidden",
            }}
          >
            <div className="valve-control-group">
              <div className="tri-switch">
                <div
                  className="tri-switch-track tri-switch-track--two"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    handleCalcTypeChange(pct < 0.5 ? "FCV" : "TCV");
                  }}
                >
                  <div
                    className="tri-switch-thumb tri-switch-thumb--two"
                    style={{
                      left:
                        effectiveCalcType === "FCV" ? "1px" : "calc(50% + 1px)",
                      background: "#222",
                    }}
                  />
                </div>
                <div className="tri-switch-labels">
                  <span
                    className={`tri-switch-label${effectiveCalcType === "FCV" ? " tri-switch-label--active" : ""}`}
                    style={
                      effectiveCalcType === "FCV" ?
                        { color: "#222" }
                      : undefined
                    }
                    onClick={() => handleCalcTypeChange("FCV")}
                  >
                    Flow (MGD)
                  </span>
                  <span
                    className={`tri-switch-label${effectiveCalcType === "TCV" ? " tri-switch-label--active" : ""}`}
                    style={
                      effectiveCalcType === "TCV" ?
                        { color: "#222" }
                      : undefined
                    }
                    onClick={() => handleCalcTypeChange("TCV")}
                  >
                    Loss Coeff. (K)
                  </span>
                </div>
              </div>
            </div>

            <div className="valve-control-group">
              <div className="valve-slider-row">
                <button
                  className="valve-step-btn"
                  onClick={() => {
                    const next = Math.max(0, localSetting - sliderStep);
                    setLocalSetting(next);
                    settingRef.current = next;
                    onOverrideChange?.({
                      ...(overrides || {}),
                      calcType: effectiveCalcType,
                      setting: next,
                      mode: "throttled",
                      status: "open",
                    });
                  }}
                >
                  −
                </button>
                <input
                  type="range"
                  className="valve-slider"
                  min="0"
                  max={sliderMax}
                  step={sliderStep}
                  value={localSetting}
                  onChange={handleSliderChange}
                  onPointerUp={commitSetting}
                  onTouchEnd={commitSetting}
                />
                <button
                  className="valve-step-btn"
                  onClick={() => {
                    const next = Math.min(sliderMax, localSetting + sliderStep);
                    setLocalSetting(next);
                    settingRef.current = next;
                    onOverrideChange?.({
                      ...(overrides || {}),
                      calcType: effectiveCalcType,
                      setting: next,
                      mode: "throttled",
                      status: "open",
                    });
                  }}
                >
                  +
                </button>
                <span className="valve-slider-value">
                  {fmtNum(localSetting, 1)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Gate / Sluice: two-way slide switch ── */}
      {(isGate || isSluice) && (
        <div className="valve-control-group">
          <div className="valve-control-label">Status</div>
          <div className="tri-switch">
            <div
              className="tri-switch-track tri-switch-track--two"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                handleStatusChange(pct < 0.5 ? "open" : "closed");
              }}
            >
              <div
                className="tri-switch-thumb tri-switch-thumb--two"
                style={{
                  left: isOpen ? "1px" : "calc(50% + 1px)",
                  background: isOpen ? "#1f78b4" : "#c0392b",
                }}
              />
            </div>
            <div className="tri-switch-labels">
              <span
                className={`tri-switch-label${isOpen ? " tri-switch-label--active" : ""}`}
                style={isOpen ? { color: "#1f78b4" } : undefined}
                onClick={() => handleStatusChange("open")}
              >
                Open
              </span>
              <span
                className={`tri-switch-label${!isOpen ? " tri-switch-label--active" : ""}`}
                style={!isOpen ? { color: "#c0392b" } : undefined}
                onClick={() => handleStatusChange("closed")}
              >
                Closed
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Non-controllable valves: static status display */}
      {!isControllable && (
        <div className="popup-row">
          <span className="popup-label">Status</span>
          <span className="popup-value">
            <span
              className={`popup-badge ${isOpen ? "popup-badge--open" : "popup-badge--closed"}`}
            >
              {isOpen ? "Open" : "Closed"}
            </span>
          </span>
        </div>
      )}

      <div className="popup-divider" style={{ margin: "4px 0 2px" }} />

      {/* ── Unified detail table ── */}
      <div style={{ paddingRight: 14 }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            marginBottom: 4,
          }}
        >
          <tbody>
            <DetailRow label="Type" unit="" textValue={capitalize(type)} />
            <DetailRow label="Size" unit="IN" value={size} />
            <DetailRow
              label="Elevation"
              unit="FT"
              value={elev}
              computed={false}
              swatch={C_ELEV}
              highlighted={
                hovered === "elev" ||
                hovered === "us_elev" ||
                hovered === "ds_elev"
              }
              hoverKey="elev"
              onHover={setHovered}
            />
            {/* Divider */}
            <tr>
              <td colSpan={4} style={{ padding: "4px 0" }}>
                <div className="popup-divider" />
              </td>
            </tr>
            {r && (
              <>
                <DetailRow
                  label="Flow"
                  unit="MGD"
                  value={r.flow}
                  computed
                  valueColor={
                    r.flow != null && r.flow < 0 ? "#c0392b" : undefined
                  }
                />
                <DetailRow
                  label="Velocity"
                  unit="FT/S"
                  value={r.velocity}
                  computed
                  valueColor={
                    r.velocity != null && r.velocity < 0 ? "#c0392b" : undefined
                  }
                />
                <DetailRow
                  label="Headloss"
                  unit="FT"
                  value={r.headloss}
                  computed
                  swatch={C_HLOSS}
                  highlighted={hovered === "headloss"}
                  hoverKey="headloss"
                  onHover={setHovered}
                  valueColor={
                    r.headloss != null && r.headloss < 0 ? "#c0392b" : undefined
                  }
                />
                {/* Divider */}
                <tr>
                  <td colSpan={4} style={{ padding: "4px 0" }}>
                    <div className="popup-divider" />
                  </td>
                </tr>
                <DetailRow
                  label="US Pressure"
                  unit="PSI"
                  value={usPres != null ? usPres * 0.43353 : null}
                  computed
                  valueColor={
                    usPres != null && usPres < 0 ? "#c0392b" : undefined
                  }
                />
                <DetailRow
                  label="US Pressure Head"
                  unit="FT"
                  value={usPres}
                  computed
                  swatch={C_PRES}
                  valueColor={
                    usPres != null && usPres < 0 ? "#c0392b" : undefined
                  }
                  highlighted={hovered === "us_pres"}
                  hoverKey="us_pres"
                  onHover={setHovered}
                />
                <DetailRow
                  label="US Total Head"
                  unit="FT"
                  value={usHead}
                  computed
                  swatch={C_TOTAL}
                  highlighted={hovered === "us_total"}
                  hoverKey="us_total"
                  onHover={setHovered}
                  valueColor={
                    usHead != null && usHead < 0 ? "#c0392b" : undefined
                  }
                />
                {/* Divider */}
                <tr>
                  <td colSpan={4} style={{ padding: "4px 0" }}>
                    <div className="popup-divider" />
                  </td>
                </tr>
                <DetailRow
                  label="DS Pressure"
                  unit="PSI"
                  value={dsPres != null ? dsPres * 0.43353 : null}
                  computed
                  valueColor={
                    dsPres != null && dsPres < 0 ? "#c0392b" : undefined
                  }
                />
                <DetailRow
                  label="DS Pressure Head"
                  unit="FT"
                  value={dsPres}
                  computed
                  swatch={C_PRES_DS}
                  valueColor={
                    dsPres != null && dsPres < 0 ? "#c0392b" : undefined
                  }
                  highlighted={hovered === "ds_pres"}
                  hoverKey="ds_pres"
                  onHover={setHovered}
                />
                <DetailRow
                  label="DS Total Head"
                  unit="FT"
                  value={dsHead}
                  computed
                  swatch={C_TOTAL_DS}
                  highlighted={hovered === "ds_total"}
                  hoverKey="ds_total"
                  onHover={setHovered}
                  valueColor={
                    dsHead != null && dsHead < 0 ? "#c0392b" : undefined
                  }
                />
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Bar chart ── */}
      {r && <div className="popup-divider" style={{ margin: "4px 0 2px" }} />}
      {r && (
        <ValveBarChart
          usElev={usElev ?? 0}
          dsElev={dsElev ?? 0}
          usHead={usHead ?? 0}
          dsHead={dsHead ?? 0}
          hovered={hovered}
          setHovered={setHovered}
        />
      )}
    </div>
  );
}
