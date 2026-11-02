import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./AuthContext";
import { ClinicThemeProvider } from "./components/ClinicThemeProvider";
import { RealtimeProvider } from "./components/RealtimeProvider";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClinicThemeProvider>
      <AuthProvider>
        <RealtimeProvider><App /></RealtimeProvider>
      </AuthProvider>
    </ClinicThemeProvider>
  </React.StrictMode>,
);
