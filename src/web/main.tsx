import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./ThemeProvider";
import { AuthGate } from "./AuthGate";
import "./index.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ThemeProvider><AuthGate>
        <App />
      </AuthGate></ThemeProvider>
    </React.StrictMode>
  );
}
