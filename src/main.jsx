import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

/* Suppress THREE.Clock deprecation warning from @react-three/fiber internals.
   R3F has not yet migrated to THREE.Timer — safe to silence until they do. */
const _origWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("Clock")) return;
  _origWarn.apply(console, args);
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
