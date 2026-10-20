import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./admin.css";

// The dashboard is its own small React app, bundled by Astro like any page
// script, so sites don't need the React integration to use it.
createRoot(document.getElementById("cms-root")!).render(<App />);
