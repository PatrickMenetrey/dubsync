import { useAuth } from "@clerk/react";
import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { apiBaseUrl } from "../api.js";

export default function ExportPanel({
  importResult,
  ttsSegments,
  volumeDUB = 100,
  volumeOV = 30
}) {
  const { getToken } = useAuth();
  const pollingRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const canExport = Boolean(importResult?.jobId && ttsSegments.length > 0);

  useEffect(
    () => () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    },
    []
  );

  const authRequest = async (config) => {
    const token = await getToken();

    return axios({
      baseURL: apiBaseUrl,
      ...config,
      headers: {
        Authorization: `Bearer ${token}`,
        ...config.headers
      }
    });
  };

  const pollStatus = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    pollingRef.current = setInterval(async () => {
      try {
        const response = await authRequest({
          method: "GET",
          url: `/api/export/status/${importResult.jobId}`
        });
        setProgress(response.data.progress ?? 0);
        setStatus(response.data.status);

        if (["completed", "failed"].includes(response.data.status)) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }

        if (response.data.status === "failed") {
          setError(response.data.error || "Export impossible.");
        }
      } catch {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
        setStatus("failed");
        setError("Impossible de suivre l'export.");
      }
    }, 1500);
  };

  const startExport = async () => {
    if (!canExport) {
      return;
    }

    setError("");
    setProgress(0);
    setStatus("processing");

    try {
      await authRequest({
        method: "POST",
        url: "/api/export",
        data: {
          jobId: importResult.jobId,
          segments: ttsSegments,
          volumeOV: volumeOV / 100,
          volumeDUB: volumeDUB / 100
        }
      });
      pollStatus();
    } catch {
      setStatus("failed");
      setError("Impossible de lancer l'export.");
    }
  };

  const downloadExport = async () => {
    setIsDownloading(true);
    setError("");

    try {
      const response = await authRequest({
        method: "GET",
        url: `/api/export/download/${importResult.jobId}`,
        responseType: "blob"
      });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "dubsync-output.mp4";
      anchor.click();
      URL.revokeObjectURL(url);
      await authRequest({
        method: "DELETE",
        url: `/api/export/cleanup/${importResult.jobId}`
      });
      setStatus("idle");
      setProgress(0);
    } catch {
      setError("Telechargement impossible.");
    } finally {
      setIsDownloading(false);
    }
  };

  if (!importResult || ttsSegments.length === 0) {
    return null;
  }

  return (
    <section className="mx-auto max-w-5xl rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-50">Export MP4</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Mix OV{" "}
            <span className="font-medium text-zinc-200">{volumeOV}%</span>
            {" · "}DUB{" "}
            <span className="font-medium text-zinc-200">{volumeDUB}%</span>
            {" · "}remux final en MP4.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            className="rounded-full bg-teal-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canExport || status === "processing"}
            onClick={startExport}
            type="button"
          >
            Exporter MP4
          </button>
          {status === "completed" ? (
            <button
              className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-teal-300 hover:text-teal-200 disabled:opacity-50"
              disabled={isDownloading}
              onClick={downloadExport}
              type="button"
            >
              Telecharger
            </button>
          ) : null}
        </div>
      </div>

      {status === "processing" ? (
        <div className="mt-6">
          <div className="mb-2 flex justify-between text-sm text-zinc-300">
            <span>Export en cours</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-teal-400 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-6 rounded-xl border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}
    </section>
  );
}
