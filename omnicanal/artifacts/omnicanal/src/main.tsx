// Primero: fija el prefijo del panel antes de que salga cualquier petición.
import "./lib/base-path";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
