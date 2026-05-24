import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import axios from "axios";
import App from "./App.jsx";
import "./styles.css";

const recentToastMessages = new Map();

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {};
    const isTransient =
      !error.response ||
      [408, 429, 500, 502, 503, 504].includes(error.response.status);

    if (isTransient && (config.__retryCount ?? 0) < 2) {
      config.__retryCount = (config.__retryCount ?? 0) + 1;
      await new Promise((resolve) => window.setTimeout(resolve, 400 * config.__retryCount));
      return axios(config);
    }

    if (!config.dubsyncSilent) {
      const message =
        error.response?.data?.error || error.message || "Erreur reseau DubSync";
      const now = Date.now();
      const lastShownAt = recentToastMessages.get(message) || 0;

      if (now - lastShownAt > 3500) {
        recentToastMessages.set(message, now);
        window.dispatchEvent(
          new CustomEvent("dubsync:toast", {
            detail: {
              message,
              type: "error"
            }
          })
        );
      }
    }

    return Promise.reject(error);
  }
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ClerkProvider>
      <App />
    </ClerkProvider>
  </React.StrictMode>
);
