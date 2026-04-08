import { useEffect, useRef } from "react";
import "./HelpModal.css";

/**
 * Help / About modal — describes how the app works.
 *
 * ⚠️  AGENT NOTE: Update this content whenever app functionality changes
 *     (new layers, popup fields, valve types, model inputs, etc.).
 */
export default function HelpModal({ open, onClose }) {
  const backdropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="help-modal-backdrop"
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="help-modal">
        <button className="help-modal-close" onClick={onClose} title="Close">
          ✕
        </button>

        <section>
          <h3>Overview</h3>
          <p>
            Interactive steady-state hydraulic model of San Francisco's water
            transmission system (Priest Reservoir → Moccasin Powerhouse). Adjust
            valves and reservoir elevations to see computed pressures, heads,
            and flows update in real time. Powered by{" "}
            <a
              href="https://github.com/modelcreate/epanet-js"
              target="_blank"
              rel="noreferrer"
            >
              epanet-js
            </a>{" "}
            (EPANET 2, running in-browser). All elevations reference NAVD 88;
            units are MGD, FT, and PSI.
          </p>
        </section>

        <section>
          <h3>Map &amp; Views</h3>
          <p>
            Switch views with the <strong>2×2 toggle</strong> (lower-right):
          </p>
          <ul>
            <li>
              <strong>2D GEO</strong> — Real-world coordinates over satellite
              imagery.
            </li>
            <li>
              <strong>2D SCH</strong> — Simplified schematic diagram on a grid.
            </li>
            <li>
              <strong>3D SCH</strong> — Isometric 3D view of the same schematic,
              showing element elevations and total hydraulic heads along the
              Z-axis as two seperate "overlays".
              <ul>
                <li>
                  <strong>Elevation Overlay</strong> — Elements positioned at
                  their actual elevations.
                </li>
                <li>
                  <strong>Total Head Overlay</strong> — Elements positioned at
                  their hydraulic total head (elevation + pressure head) as
                  computed by the model.
                </li>
                <li>Opacity slides control visibility of each overlay.</li>
              </ul>
            </li>
            <li>
              <strong>3D GEO</strong> — Isometric 3D view combining the
              real-world coordinates from the 2D GEO view with the same Z-axis
              overlays for elevation and total head.
              <ul>
                <li>
                  Faint white vertical lines connect each element's position on
                  the base map to the elevation and total head overlays.
                </li>
              </ul>
            </li>
          </ul>
          <p>Map symbology:</p>
          <ul>
            <li>
              <strong>Pipes</strong> — Blue animated lines = flowing; gray = no
              flow. Animation direction follows hydraulic flow (high head → low
              head).
            </li>
            <li>
              <strong>Valves</strong> — Blue = open, yellow = throttled, red =
              closed.
            </li>
            <li>
              <strong>Overflow</strong> — Turns red when active.
            </li>
          </ul>
        </section>

        <section>
          <h3>Interacting with Elements</h3>
          <p>
            Click any element to open its popup. In popup tables,{" "}
            <strong style={{ color: "#4A90D9" }}>blue values</strong> are
            model-calculated; black values are inputs. Negative values appear in{" "}
            <strong style={{ color: "#c0392b" }}>red</strong>. Charts visualize
            the elevation/pressure-head/total-head breakdown.
          </p>
          <ul>
            <li>
              <strong>Valves</strong> — Butterfly valves: Open / Throttled (set
              target flow or head-loss coefficient) / Closed. Gate &amp; Sluice
              valves: Open / Closed.
            </li>
            <li>
              <strong>Reservoirs &amp; Overflow</strong> — Adjust elevation with
              the slider; the model re-runs instantly.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
