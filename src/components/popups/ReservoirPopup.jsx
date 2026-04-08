import { useState, useRef, useEffect } from "react";
import "./PopupStyles.css";
import { fmtNum } from "../../utils/fmt.js";

const ELEV_MIN = 0;
const ELEV_MAX = 2500;
const ELEV_STEP = 1;

export default function ReservoirPopup({
  properties,
  results,
  elevOverride,
  onElevChange,
}) {
  const { name, elev: baseElev } = properties;
  const effectiveElev = elevOverride ?? baseElev;
  const r = results?.nodes?.[name];

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
      <div className="popup-header">{name}</div>
      <div className="popup-row">
        <span className="popup-label">Elevation (FT)</span>
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
      {r && (
        <div className="popup-row">
          <span className="popup-label">Net Flow (MGD)</span>
          <span
            className="popup-value"
            style={
              r.demand < 0 ? { color: "#c0392b", fontWeight: 600 } : undefined
            }
          >
            {fmtNum(r.demand)}
          </span>
        </div>
      )}
    </div>
  );
}
