import { useState } from "react";
import "./PopupStyles.css";
import { fmtNum } from "../../utils/fmt.js";

/* ── Colour constants matching branding image ──── */
const C_TOTAL = "#4A90D9"; // blue   – total head
const C_ELEV = "#95C13D"; // lime   – elevation
const C_PRES = "#F5B731"; // amber  – pressure head

/** Bar fill opacity (semi-transparent for aesthetics) */
const BAR_OPACITY = 0.65;
const BAR_HOVER_OPACITY = 0.9;

/**
 * Inline SVG bar chart with hoverable sections.
 *
 * Bar 1 (left):  Total Head — single bar.
 * Bar 2 (right): Elevation (bottom) + Pressure Head (top) stacked.
 *
 * hovered/setHovered are lifted to parent so the table can react too.
 */
function HeadChart({
  totalHead,
  elevation,
  pressureHead,
  hovered,
  setHovered,
}) {
  const W = 240;
  const H = 140;
  const padTop = 22;
  const padBot = 8;
  const padLeft = 44;
  const padRight = 12;
  const barW = 52;
  const gap = 32;
  const chartH = H - padTop - padBot;
  const chartW = W - padLeft - padRight;

  const presNeg = pressureHead < 0;
  const absPres = Math.abs(pressureHead);
  const maxVal = Math.max(totalHead, elevation + absPres, elevation, 1);
  const scale = (v) => (v / maxVal) * chartH;

  const totalBarW = barW * 2 + gap;
  const startX = padLeft + (chartW - totalBarW) / 2;
  const x1 = startX;
  const x2 = startX + barW + gap;
  const baseY = padTop + chartH;

  const hTotal = scale(Math.max(0, totalHead));
  const hElev = scale(elevation);
  const hPres = scale(absPres);

  // Nice y-axis ticks
  const niceStep = (range) => {
    const rough = range / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const res = rough / mag;
    if (res <= 1.5) return mag;
    if (res <= 3.5) return 2 * mag;
    if (res <= 7.5) return 5 * mag;
    return 10 * mag;
  };
  const step = niceStep(maxVal);
  const ticks = [];
  for (let v = 0; v <= maxVal; v += step) {
    const y = baseY - scale(v);
    ticks.push(
      <g key={v}>
        <line
          x1={padLeft - 4}
          y1={y}
          x2={padLeft}
          y2={y}
          stroke="#999"
          strokeWidth="1"
        />
        <text
          x={padLeft - 7}
          y={y + 3.5}
          textAnchor="end"
          fontSize="9"
          fill="#666"
        >
          {Math.round(v)}
        </text>
      </g>,
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={W}
      height={H}
      style={{ display: "block", margin: "4px auto 0" }}
    >
      {/* Axes */}
      <line
        x1={padLeft}
        y1={padTop}
        x2={padLeft}
        y2={baseY}
        stroke="#bbb"
        strokeWidth="1"
      />
      <line
        x1={padLeft}
        y1={baseY}
        x2={W - padRight}
        y2={baseY}
        stroke="#bbb"
        strokeWidth="1"
      />
      {ticks}

      {/* Bar 1: Elevation (bottom) */}
      <rect
        x={x1}
        y={baseY - hElev}
        width={barW}
        height={hElev}
        fill={C_ELEV}
        fillOpacity={hovered === "elev" ? BAR_HOVER_OPACITY : BAR_OPACITY}
        rx="0"
        style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
        onMouseEnter={() => setHovered("elev")}
        onMouseLeave={() => setHovered(null)}
      />

      {/* Bar 1: Pressure Head (top of stack, or below elev if negative) */}
      <rect
        x={x1}
        y={presNeg ? baseY - hElev : baseY - hElev - hPres}
        width={barW}
        height={hPres}
        fill={C_PRES}
        fillOpacity={hovered === "pres" ? BAR_HOVER_OPACITY : BAR_OPACITY}
        rx="3"
        style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
        onMouseEnter={() => setHovered("pres")}
        onMouseLeave={() => setHovered(null)}
      />

      {/* Bar 2: Total Head */}
      <rect
        x={x2}
        y={baseY - hTotal}
        width={barW}
        height={hTotal}
        fill={C_TOTAL}
        fillOpacity={hovered === "total" ? BAR_HOVER_OPACITY : BAR_OPACITY}
        rx="3"
        style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
        onMouseEnter={() => setHovered("total")}
        onMouseLeave={() => setHovered(null)}
      />
    </svg>
  );
}

/**
 * One row of the 4-column detail table.
 */
function DetailRow({
  label,
  unit,
  value,
  computed = false,
  swatch = null,
  highlighted = false,
  valueColor = null,
}) {
  const valColor = valueColor || (computed ? C_TOTAL : "#222");
  const rowStyle =
    highlighted ?
      { background: "#f0f6ff", transition: "background 0.15s" }
    : { transition: "background 0.15s" };
  return (
    <tr style={rowStyle}>
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
        {fmtNum(value, 2)}
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

export default function NodePopup({ properties, results }) {
  const { name, elev } = properties;
  const r = results?.nodes?.[name];
  const [hovered, setHovered] = useState(null); // "total" | "elev" | "pres" | null

  const pressureHeadFt = r ? r.head - elev : null;
  const flowMGD = r ? r.flow : null;

  return (
    <div className="popup-container">
      <div className="popup-header">{name}</div>
      {r ?
        <>
          <table
            style={{
              borderCollapse: "collapse",
              fontSize: 13,
              marginBottom: 4,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <tbody>
              <DetailRow
                label="In/Out Flow"
                unit="MGD"
                value={flowMGD}
                computed
                swatch={null}
                valueColor={
                  flowMGD != null && flowMGD < 0 ? "#c0392b" : undefined
                }
              />
              <DetailRow
                label="Elevation"
                unit="FT"
                value={elev}
                computed={false}
                swatch={C_ELEV}
                highlighted={hovered === "elev"}
              />
              <DetailRow
                label="Pressure"
                unit="PSI"
                value={r.pressure}
                computed
                swatch={null}
                valueColor={
                  r.pressure != null && r.pressure < 0 ? "#c0392b" : undefined
                }
              />
              <DetailRow
                label="Pressure Head"
                unit="FT"
                value={pressureHeadFt}
                computed
                swatch={C_PRES}
                highlighted={hovered === "pres"}
                valueColor={
                  pressureHeadFt != null && pressureHeadFt < 0 ?
                    "#c0392b"
                  : undefined
                }
              />
              <DetailRow
                label="Total Head"
                unit="FT"
                value={r.head}
                computed
                swatch={C_TOTAL}
                highlighted={hovered === "total"}
                valueColor={
                  r.head != null && r.head < 0 ? "#c0392b" : undefined
                }
              />
            </tbody>
          </table>
          <HeadChart
            totalHead={r.head}
            elevation={elev}
            pressureHead={pressureHeadFt}
            hovered={hovered}
            setHovered={setHovered}
          />
        </>
      : <div className="popup-row">
          <span className="popup-label">Elevation (ft)</span>
          <span className="popup-value">{fmtNum(elev, 0)}</span>
        </div>
      }
    </div>
  );
}
