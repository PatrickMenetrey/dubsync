import { useAuth } from "@clerk/react";
import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { apiBaseUrl } from "../api.js";

const accept = ".mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/webm";
const cloudflareFreeUploadLimitBytes = 95 * 1024 * 1024;

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return "-";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function MetadataItem({ label, value }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs uppercase text-zinc-500">{label}</p>
      <p className="mt-2 text-lg font-medium text-zinc-50">{value}</p>
    </div>
  );
}

export default function ImportPanel({ importResult, onImportComplete }) {
  const { getToken } = useAuth();
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [metadata, setMetadata] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl]
  );

  useEffect(() => {
    if (!importResult?.jobId || previewUrl) {
      return undefined;
    }

    let objectUrl = "";
    let isCancelled = false;

    const loadImportedPreview = async () => {
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
          setPreviewUrl(objectUrl);
          setSelectedFileName(importResult.videoName || "Vidéo importée");
          setMetadata(importResult);
        }
      } catch {
        setError("Impossible de recharger l'aperçu vidéo.");
      }
    };

    loadImportedPreview();

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [getToken, importResult, previewUrl]);

  const uploadFile = async (file) => {
    if (!file) {
      return;
    }

    setError("");
    setMetadata(null);
    setProgress(0);
    setIsUploading(true);
    setSelectedFileName(file.name);
    setPreviewUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
      return URL.createObjectURL(file);
    });

    if (
      window.location.hostname.endsWith(".trycloudflare.com") &&
      file.size > cloudflareFreeUploadLimitBytes
    ) {
      setError(
        "Cette URL de test Cloudflare limite les uploads autour de 100 MB. Utilise une vidéo plus légère pour les tests à distance, ou lance DubSync en local pour les gros fichiers."
      );
      setIsUploading(false);
      return;
    }

    const formData = new FormData();
    formData.append("video", file);

    try {
      const token = await getToken();
      const response = await axios.post(
        `${apiBaseUrl}/api/upload`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          onUploadProgress(event) {
            if (event.total) {
              setProgress(Math.round((event.loaded * 100) / event.total));
            }
          }
        }
      );

      setMetadata(response.data);
      onImportComplete?.(response.data);
      setProgress(100);
    } catch (uploadError) {
      setError(
        uploadError.response?.data?.error ||
          "Upload impossible. Verifie le format et la piste audio."
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    uploadFile(event.dataTransfer.files?.[0]);
  };

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Importer une video</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Formats acceptes : MP4, MOV, MKV, WebM.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(320px,1fr)_minmax(320px,520px)]">
        <div
          className={`flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center transition ${
            isDragging
              ? "border-teal-300 bg-teal-950/30"
              : "border-zinc-700 bg-zinc-900"
          }`}
          onDragLeave={() => setIsDragging(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDrop={handleDrop}
        >
          <p className="text-lg font-medium text-zinc-100">
            Depose ta video ici
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            ou selectionne un fichier depuis ton ordinateur
          </p>
          <button
            className="mt-6 rounded-md bg-teal-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            Choisir une video
          </button>
          <input
            ref={inputRef}
            accept={accept}
            className="hidden"
            onChange={(event) => uploadFile(event.target.files?.[0])}
            type="file"
          />
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-100">
              Prévisualisation
            </h2>
            {selectedFileName ? (
              <span className="truncate text-xs text-zinc-500">
                {selectedFileName}
              </span>
            ) : null}
          </div>
          {previewUrl ? (
            <video
              className="aspect-video w-full rounded-md bg-black"
              controls
              src={previewUrl}
            />
          ) : (
            <div className="grid aspect-video place-items-center rounded-md border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
              La vidéo sélectionnée apparaîtra ici.
            </div>
          )}
        </div>
      </div>

      {isUploading ? (
        <div className="mt-6">
          <div className="mb-2 flex justify-between text-sm text-zinc-300">
            <span>Upload en cours</span>
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
        <p className="mt-6 rounded-md border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      {metadata ? (
        <div className="mt-6">
          {metadata.audioSizeMb > 25 ? (
            <span className="mb-4 inline-flex rounded-md bg-amber-300 px-3 py-1 text-xs font-semibold text-zinc-950">
              Mode chunking active
            </span>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-4">
            <MetadataItem
              label="Duree"
              value={formatDuration(metadata.duration)}
            />
            <MetadataItem
              label="Resolution"
              value={metadata.resolution || "-"}
            />
            <MetadataItem label="Codec" value={metadata.codec || "-"} />
            <MetadataItem
              label="Taille audio"
              value={`${metadata.audioSizeMb} MB`}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
