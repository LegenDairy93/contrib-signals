import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ScoutClient from "../app/ScoutClient";
import "../app/globals.css";
import { staticScoutTransport } from "./static-scout";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ScoutClient transport={staticScoutTransport} />
  </StrictMode>,
);
