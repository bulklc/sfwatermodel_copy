import "./ViewModeSwitch.css";

const MODES = [
  { id: "2d-geo", label: "2D", col: "GEO", row: "2D", enabled: true },
  { id: "2d-sch", label: "2D", col: "SCH", row: "2D", enabled: true },
  { id: "3d-geo", label: "3D", col: "GEO", row: "3D", enabled: true },
  { id: "3d-sch", label: "3D", col: "SCH", row: "3D", enabled: true },
];

function Tip({ text, children }) {
  return (
    <span className="vms-tip-wrap">
      {children}
      <span className="vms-tip">{text}</span>
    </span>
  );
}

export default function ViewModeSwitch({
  activeMode = "2d-geo",
  onModeChange,
}) {
  return (
    <div className="view-mode-switch">
      {/* Column headers */}
      <div className="vms-header"></div>
      <Tip text="Geographic — real-world map with satellite imagery">
        <div className="vms-col-label">GEO</div>
      </Tip>
      <Tip text="Schematic — circuit-diagram-style layout">
        <div className="vms-col-label">SCH</div>
      </Tip>

      {/* 2D row */}
      <div className="vms-row-label">2D</div>
      {MODES.filter((m) => m.row === "2D").map((mode) => (
        <button
          key={mode.id}
          className={
            "vms-cell" +
            (activeMode === mode.id ? " vms-active" : "") +
            (!mode.enabled ? " vms-disabled" : "")
          }
          disabled={!mode.enabled}
          onClick={() => mode.enabled && onModeChange?.(mode.id)}
        />
      ))}

      {/* 3D row */}
      <div className="vms-row-label">3D</div>
      {MODES.filter((m) => m.row === "3D").map((mode) => (
        <button
          key={mode.id}
          className={
            "vms-cell" +
            (activeMode === mode.id ? " vms-active" : "") +
            (!mode.enabled ? " vms-disabled" : "")
          }
          disabled={!mode.enabled}
          onClick={() => mode.enabled && onModeChange?.(mode.id)}
        />
      ))}
    </div>
  );
}
