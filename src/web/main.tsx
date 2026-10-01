import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./AuthGate";
import "./index.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AuthGate>
        <App />
      </AuthGate>
    </React.StrictMode>
  );
}
