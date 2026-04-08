import { useState, useRef, useEffect } from "react";
import "./PopupStyles.css";
import { fmtNum } from "../../utils/fmt.js";

const ELEV_MIN = 0;
const ELEV_MAX = 2500;
const ELEV_STEP = 1;

export default function OverflowPopup({
  properties,
  results,
  elevOverride,
  onElevChange,
}) {
  const { name, elev: baseElev } = properties;
  const effectiveElev = elevOverride ?? baseElev;
  const shaftName = name + "_shaft";
  const shaftNode = results?.nodes?.[shaftName];
  const ovf = results?.overflow?.[name];
  const isActive = ovf?.active;

  const [localElev, setLocalElev] = useState(effectiveElev);
  const elevRef = useRef(effectiveElev);

  useEffect(() => {
    setLocalElev(effectiveElev);
    elevRef.current = effectiveElev;
  }, [effectiveElev]);

  const commitElev = () => {
    const v = elevRef.current;
    if (v !== effectiveElev) onElevChange?.(v);
  };

  const stepElev = (delta) => {
    const next = Math.max(ELEV_MIN, Math.min(ELEV_MAX, localElev + delta));
    setLocalElev(next);
    elevRef.current = next;
    onElevChange?.(next);
  };

  return (
    <div className="popup-container">
      <div className="popup-header">Overflow Shaft</div>
      <div className="popup-row">
        <span className="popup-label">Weir Crest Elev (FT)</span>
        <span className="popup-value">{fmtNum(localElev, 2)}</span>
      </div>
      <div className="valve-control-group">
        <div className="valve-slider-row elev-slider-row">
          <button
            className="valve-step-btn"
            onClick={() => stepElev(-ELEV_STEP)}
          >
            −
          </button>
          <input
            type="range"
            className="valve-slider"
            min={ELEV_MIN}
            max={ELEV_MAX}
            step={ELEV_STEP}
            value={localElev}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setLocalElev(v);
              elevRef.current = v;
            }}
            onPointerUp={commitElev}
            onTouchEnd={commitElev}
          />
          <button
            className="valve-step-btn"
            onClick={() => stepElev(ELEV_STEP)}
          >
            +
          </button>
        </div>
      </div>
      {shaftNode && (
        <>
          <div className="popup-row">
            <span className="popup-label">Overflow Flow (MGD)</span>
            <span
              className="popup-value"
              style={{
                color: isActive ? "#c0392b" : "inherit",
                fontWeight: isActive ? 700 : "normal",
              }}
            >
              {fmtNum(ovf?.flow, 4)}
              {isActive ? " ⚠" : ""}
            </span>
          </div>
          <div className="popup-row">
            <span className="popup-label">Status</span>
            <span
              className="popup-value"
              style={{
                color: isActive ? "#c0392b" : "#27ae60",
                fontWeight: 700,
              }}
            >
              {isActive ? "OVERFLOW ACTIVE" : "No Overflow"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
