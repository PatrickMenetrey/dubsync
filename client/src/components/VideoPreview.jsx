import { useAuth } from "@clerk/react";
import axios from "axios";
import { useEffect, useState } from "react";
import { apiBaseUrl } from "../api.js";

export default function VideoPreview({ importResult }) {
  const { getToken } = useAuth();
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let objectUrl = "";
    let isCancelled = false;

    const loadVideo = async () => {
      if (!importResult?.jobId) {
        setVideoUrl("");
        setError("");
        return;
      }

      setError("");

      try {
        const token = await getToken();
        const response = await axios.get(
          `${apiBaseUrl}/api/jobs/${importResult.jobId}/video`,
          {
            headers: { Authorization: `Bearer ${token}` },
            responseType: "blob"
          }
        );

        objectUrl = URL.createObjectURL(response.data);
        if (!isCancelled) {
          setVideoUrl(objectUrl);
        }
      } catch {
        setError("Impossible de charger l'aperçu vidéo.");
      }
    };

    loadVideo();

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [getToken, importResult?.jobId]);

  if (!importResult?.jobId) {
    return null;
  }

  return (
    <section className="mx-auto max-w-6xl rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-zinc-50">Aperçu vidéo</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Vérifie l'image originale avant transcription et doublage.
          </p>
        </div>
        <span className="rounded-md bg-zinc-800 px-2 py-1 text-xs font-semibold text-zinc-200">
          {importResult.resolution || "Vidéo"}
        </span>
      </div>
      {error ? (
        <p className="rounded-md border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      ) : (
        <video
          className="aspect-video w-full rounded-md bg-black"
          controls
          src={videoUrl}
        />
      )}
    </section>
  );
}
