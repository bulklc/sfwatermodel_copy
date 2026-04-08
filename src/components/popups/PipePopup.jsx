import { useState } from "react";
import "./PopupStyles.css";
import { fmtNum } from "../../utils/fmt.js";

/* ── Colour constants (consistent with NodePopup) ──── */
const C_TOTAL = "#4A90D9"; // blue   – total head
const C_ELEV = "#95C13D"; // lime   – elevation
const C_PRES = "#F5B731"; // amber  – pressure head

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

/* ── Shared DetailRow (same layout as NodePopup) ───── */
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

/* ── Bar chart (DS left, US right — no connecting lines) ─── */
function PipeBarChart({ usElev, dsElev, usHead, dsHead, hovered, setHovered }) {
  const usPres = usHead - usElev;
  const dsPres = dsHead - dsElev;

  const usPresNeg = usPres < 0;
  const dsPresNeg = dsPres < 0;

  const W = 310;
  const H = 120;
  const padTop = 18;
  const padBot = 18;
  const padLeft = 14;
  const padRight = 52;
  const barW = 22;
  const barGap = 3;
  const chartH = H - padTop - padBot;
  const chartW = W - padLeft - padRight;

  const maxVal = Math.max(
    usHead,
    dsHead,
    usElev + Math.abs(usPres),
    dsElev + Math.abs(dsPres),
    1,
  );
  const scale = (v) => (v / maxVal) * chartH;
  const baseY = padTop + chartH;

  const pairW = barW * 2 + barGap;

  /* DS pair flush left, US pair flush right */
  const xDS_total = padLeft;
  const xDS_stack = xDS_total + barW + barGap;
  const xUS_total = padLeft + chartW - pairW + barW + barGap;
  const xUS_stack = xUS_total - barW - barGap;

  const hUsElev = scale(usElev);
  const hUsPres = scale(Math.abs(usPres));
  const hDsElev = scale(dsElev);
  const hDsPres = scale(Math.abs(dsPres));
  const hUsHead = scale(Math.max(0, usHead));
  const hDsHead = scale(Math.max(0, dsHead));

  const step = niceStep(maxVal);
  const axisRight = W - padRight;
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

  const dsCX = xDS_total + pairW / 2;
  const usCX = xUS_stack + pairW / 2;

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
        x={xDS_stack}
        y={baseY - hDsElev}
        width={barW}
        height={hDsElev}
        fill={C_ELEV_DS}
        fillOpacity={hovered === "ds_elev" ? BAR_HOVER_OPACITY : BAR_OPACITY}
        rx="0"
        style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
        onMouseEnter={() => setHovered("ds_elev")}
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
        style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
        onMouseEnter={() => setHovered("ds_pres")}
        onMouseLeave={() => setHovered(null)}
      />
      <rect
        x={xDS_total}
        y={baseY - hDsHead}
        width={barW}
        height={hDsHead}
        fill={C_TOTAL_DS}
        fillOpacity={hovered === "ds_total" ? BAR_HOVER_OPACITY : BAR_OPACITY}
        rx="3"
        style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
        onMouseEnter={() => setHovered("ds_total")}
        onMouseLeave={() => setHovered(null)}
      />

      {/* US bars */}
      <rect
        x={xUS_total}
        y={baseY - hUsHead}
        width={barW}
        height={hUsHead}
        fill={C_TOTAL}
        fillOpacity={hovered === "us_total" ? BAR_HOVER_OPACITY : BAR_OPACITY}
        rx="3"
        style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
        onMouseEnter={() => setHovered("us_total")}
        onMouseLeave={() => setHovered(null)}
      />
      <rect
        x={xUS_stack}
        y={baseY - hUsElev}
        width={barW}
        height={hUsElev}
        fill={C_ELEV}
        fillOpacity={hovered === "us_elev" ? BAR_HOVER_OPACITY : BAR_OPACITY}
        rx="0"
        style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
        onMouseEnter={() => setHovered("us_elev")}
        onMouseLeave={() => setHovered(null)}
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
        style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
        onMouseEnter={() => setHovered("us_pres")}
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

/* ── Energy Profile line chart (auto-scaled Y) ─────── */
function EnergyProfile({
  usElev,
  dsElev,
  usHead,
  dsHead,
  pipeLength,
  hovered,
  setHovered,
}) {
  const usHGL = usElev + (usHead - usElev); // same as usHead
  const dsHGL = dsElev + (dsHead - dsElev); // same as dsHead

  const W = 310;
  const H = 120;
  const padTop = 18;
  const padBot = 18;
  const padLeft = 14;
  const padRight = 52;
  const chartH = H - padTop - padBot;

  /* Match bar-chart layout to align endpoints with bar gaps */
  const barW = 22;
  const barGap = 3;
  const chartW = W - padLeft - padRight;
  const pairW = barW * 2 + barGap;

  /* DS pair flush left, US pair flush right */
  const xDS_total = padLeft;
  const xUS_stack = padLeft + chartW - pairW;
  /* Midpoint of the gap between each pair of bars */
  const xLeft = xDS_total + barW + barGap / 2; // DS gap midpoint
  const xRight = xUS_stack + barW + barGap / 2; // US gap midpoint

  /* Auto-scale Y to just the total head range with ~20% padding */
  const dataMin = Math.min(usHead, dsHead);
  const dataMax = Math.max(usHead, dsHead);
  const dataRange = dataMax - dataMin || 1;
  const pad20 = dataRange * 0.2;
  const yMin = dataMin - pad20;
  const yMax = dataMax + pad20;
  const yRange = yMax - yMin;

  const scaleY = (v) => padTop + chartH - ((v - yMin) / yRange) * chartH;

  /* Y-axis ticks */
  const step = niceStep(yRange, 3);
  const firstTick = Math.ceil(yMin / step) * step;
  const tickDecimals = step < 1 ? Math.max(1, Math.ceil(-Math.log10(step))) : 0;
  const axisRight = W - padRight;
  const ticks = [];
  for (let v = firstTick; v <= yMax; v += step) {
    const y = scaleY(v);
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
          {v.toFixed(2)}
        </text>
      </g>,
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={W}
      height={H}
      style={{ display: "block", margin: "0 auto" }}
    >
      {/* axes */}
      <line
        x1={axisRight}
        y1={padTop}
        x2={axisRight}
        y2={padTop + chartH}
        stroke="#bbb"
        strokeWidth="1"
      />
      <line
        x1={padLeft}
        y1={padTop + chartH}
        x2={axisRight}
        y2={padTop + chartH}
        stroke="#bbb"
        strokeWidth="1"
      />
      {ticks}

      {/* Dashed alignment lines from marker dots to axes */}
      {/* US dot → vertical to x-axis, horizontal to y-axis */}
      <line
        x1={xRight}
        y1={scaleY(usHead)}
        x2={xRight}
        y2={padTop + chartH}
        stroke={C_TOTAL}
        strokeWidth={hovered === "us_total" ? 1.2 : 0.7}
        strokeDasharray="3 2"
        opacity={hovered === "us_total" ? 0.8 : 0.5}
      />
      <line
        x1={xRight}
        y1={scaleY(usHead)}
        x2={axisRight}
        y2={scaleY(usHead)}
        stroke={C_TOTAL}
        strokeWidth={hovered === "us_total" ? 1.2 : 0.7}
        strokeDasharray="3 2"
        opacity={hovered === "us_total" ? 0.8 : 0.5}
      />
      {/* DS dot → vertical to x-axis, horizontal to y-axis */}
      <line
        x1={xLeft}
        y1={scaleY(dsHead)}
        x2={xLeft}
        y2={padTop + chartH}
        stroke={C_TOTAL}
        strokeWidth={hovered === "ds_total" ? 1.2 : 0.7}
        strokeDasharray="3 2"
        opacity={hovered === "ds_total" ? 0.8 : 0.5}
      />
      <line
        x1={xLeft}
        y1={scaleY(dsHead)}
        x2={axisRight}
        y2={scaleY(dsHead)}
        stroke={C_TOTAL}
        strokeWidth={hovered === "ds_total" ? 1.2 : 0.7}
        strokeDasharray="3 2"
        opacity={hovered === "ds_total" ? 0.8 : 0.5}
      />

      {/* EGL line (blue ant-trail): DS on left, US on right */}
      <line
        x1={xLeft}
        y1={scaleY(dsHead)}
        x2={xRight}
        y2={scaleY(usHead)}
        stroke={C_TOTAL}
        strokeWidth={hovered === "headloss" ? 3 : 1.5}
        strokeDasharray="6 4"
        opacity={hovered === "headloss" ? 1 : 0.9}
        style={{ transition: "stroke-width 0.15s" }}
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="20"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </line>
      {/* Invisible wide hover target for EGL line */}
      <line
        x1={xLeft}
        y1={scaleY(dsHead)}
        x2={xRight}
        y2={scaleY(usHead)}
        stroke="transparent"
        strokeWidth="12"
        style={{ cursor: "pointer" }}
        onMouseEnter={() => setHovered("headloss")}
        onMouseLeave={() => setHovered(null)}
      />
      {/* Endpoint markers */}
      <circle
        cx={xRight}
        cy={scaleY(usHead)}
        r={hovered === "us_total" ? 5 : 3}
        fill={C_TOTAL}
        stroke="#fff"
        strokeWidth={hovered === "us_total" ? 1.5 : 0}
        style={{ transition: "r 0.15s", cursor: "pointer" }}
      />
      <circle
        cx={xLeft}
        cy={scaleY(dsHead)}
        r={hovered === "ds_total" ? 5 : 3}
        fill={C_TOTAL}
        stroke="#fff"
        strokeWidth={hovered === "ds_total" ? 1.5 : 0}
        style={{ transition: "r 0.15s", cursor: "pointer" }}
      />
      {/* Invisible hover targets */}
      <circle
        cx={xRight}
        cy={scaleY(usHead)}
        r="10"
        fill="transparent"
        style={{ cursor: "pointer" }}
        onMouseEnter={() => setHovered("us_total")}
        onMouseLeave={() => setHovered(null)}
      />
      <circle
        cx={xLeft}
        cy={scaleY(dsHead)}
        r="10"
        fill="transparent"
        style={{ cursor: "pointer" }}
        onMouseEnter={() => setHovered("ds_total")}
        onMouseLeave={() => setHovered(null)}
      />

      {/* X-axis ticks: 0 at US (right), pipeLength at DS (left) */}
      {(() => {
        const xLen = xRight - xLeft; // pixel span
        const xStep = niceStep(pipeLength, 3);
        const xTicks = [];
        for (let d = 0; d <= pipeLength; d += xStep) {
          const px = xRight - (d / pipeLength) * xLen; // 0 at right, length at left
          xTicks.push(
            <g key={`xt-${d}`}>
              <line
                x1={px}
                y1={padTop + chartH}
                x2={px}
                y2={padTop + chartH + 4}
                stroke="#999"
                strokeWidth="1"
              />
              <text
                x={px}
                y={H - 2}
                textAnchor="middle"
                fontSize="9"
                fill="#666"
              >
                {Math.round(d).toLocaleString()}
              </text>
            </g>,
          );
        }
        return xTicks;
      })()}
    </svg>
  );
}

/* ── Main popup component ──────────────────────────── */
export default function PipePopup({ properties, results }) {
  const { name, size, type, length } = properties;
  const r = results?.pipes?.[name];
  const [hovered, setHovered] = useState(null);

  /* Derive upstream / downstream values from pipe results */
  const usHead = r?.us_head;
  const dsHead = r?.ds_head;
  const usElev = r?.us_elev;
  const dsElev = r?.ds_elev;
  const usPres = usHead != null && usElev != null ? usHead - usElev : null;
  const dsPres = dsHead != null && dsElev != null ? dsHead - dsElev : null;

  return (
    <div className="popup-container">
      <div className="popup-header">{name}</div>

      {r ?
        <>
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
                <DetailRow label="Length" unit="FT" value={length} />
                {/* Divider */}
                <tr>
                  <td colSpan={4} style={{ padding: "4px 0" }}>
                    <div className="popup-divider" />
                  </td>
                </tr>
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
                  label="US Elevation"
                  unit="FT"
                  value={usElev}
                  computed={false}
                  swatch={C_ELEV}
                  highlighted={hovered === "us_elev"}
                  hoverKey="us_elev"
                  onHover={setHovered}
                />
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
                  highlighted={hovered === "us_pres"}
                  hoverKey="us_pres"
                  onHover={setHovered}
                  valueColor={
                    usPres != null && usPres < 0 ? "#c0392b" : undefined
                  }
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
                  label="DS Elevation"
                  unit="FT"
                  value={dsElev}
                  computed={false}
                  swatch={C_ELEV_DS}
                  highlighted={hovered === "ds_elev"}
                  hoverKey="ds_elev"
                  onHover={setHovered}
                />
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
                  highlighted={hovered === "ds_pres"}
                  hoverKey="ds_pres"
                  onHover={setHovered}
                  valueColor={
                    dsPres != null && dsPres < 0 ? "#c0392b" : undefined
                  }
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
              </tbody>
            </table>
          </div>

          <div className="popup-divider" style={{ margin: "4px 0 2px" }} />

          <PipeBarChart
            usElev={usElev ?? 0}
            dsElev={dsElev ?? 0}
            usHead={usHead ?? 0}
            dsHead={dsHead ?? 0}
            hovered={hovered}
            setHovered={setHovered}
          />

          <EnergyProfile
            usElev={usElev ?? 0}
            dsElev={dsElev ?? 0}
            usHead={usHead ?? 0}
            dsHead={dsHead ?? 0}
            pipeLength={length ?? 0}
            hovered={hovered}
            setHovered={setHovered}
          />
        </>
      : <>
          <div className="popup-row">
            <span className="popup-label">Size (in)</span>
            <span className="popup-value">{size ?? "—"}</span>
          </div>
          <div className="popup-row">
            <span className="popup-label">Type</span>
            <span className="popup-value">{capitalize(type)}</span>
          </div>
          <div className="popup-row">
            <span className="popup-label">Length (ft)</span>
            <span className="popup-value">{fmtNum(length, 0)}</span>
          </div>
        </>
      }
    </div>
  );
}
