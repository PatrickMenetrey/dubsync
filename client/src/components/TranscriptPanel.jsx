import { useAuth } from "@clerk/react";
import axios from "axios";
import { useState } from "react";
import { apiBaseUrl } from "../api.js";

const languages = [
  { label: "Auto", value: "" },
  { label: "Francais", value: "fr" },
  { label: "Anglais", value: "en" },
  { label: "Allemand", value: "de" },
  { label: "Espagnol", value: "es" },
  { label: "Italien", value: "it" }
];

function formatTimestamp(seconds) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, "0");
  const remainingSeconds = (safeSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

export default function TranscriptPanel({ importResult, onTranscriptChange }) {
  const { getToken } = useAuth();
  const [language, setLanguage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [segments, setSegments] = useState([]);
  const [error, setError] = useState("");
  const usesChunking = Number(importResult?.audioSizeMb ?? 0) > 25;

  const transcribe = async () => {
    if (!importResult?.jobId) {
      return;
    }

    setError("");
    setIsProcessing(true);

    try {
      const token = await getToken();
      const response = await axios.post(
        `${apiBaseUrl}/api/transcribe`,
        {
          jobId: importResult.jobId,
          ...(language ? { language } : {})
        },
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      setSegments(response.data.transcript);
      onTranscriptChange?.(response.data.transcript);
    } catch (transcribeError) {
      setError(
        transcribeError.response?.data?.error ||
          "Transcription impossible pour ce fichier."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const updateSegment = (segmentId, text) => {
    setSegments((currentSegments) => {
      const nextSegments = currentSegments.map((segment) =>
        segment.id === segmentId ? { ...segment, text } : segment
      );
      onTranscriptChange?.(nextSegments);
      return nextSegments;
    });
  };

  if (!importResult) {
    return null;
  }

  return (
    <section className="mx-auto mt-10 max-w-5xl rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-50">Transcription</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Lance Whisper sur l'audio extrait.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            disabled={isProcessing}
            onChange={(event) => setLanguage(event.target.value)}
            value={language}
          >
            {languages.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className="rounded-md bg-teal-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isProcessing}
            onClick={transcribe}
            type="button"
          >
            Transcrire
          </button>
        </div>
      </div>

      {isProcessing ? (
        <div className="mt-6 flex items-center gap-3 text-sm text-zinc-300">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-teal-300" />
          <span>
            {usesChunking ? "Chunking en cours..." : "Transcription en cours..."}
          </span>
        </div>
      ) : null}

      {error ? (
        <p className="mt-6 rounded-md border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      {segments.length > 0 ? (
        <div className="mt-6 space-y-3">
          {segments.map((segment) => (
            <div
              className="rounded-lg border border-zinc-800 bg-zinc-950 p-4"
              key={segment.id}
            >
              <p className="mb-3 text-xs font-medium text-teal-200">
                [{formatTimestamp(segment.start)} → {formatTimestamp(segment.end)}]
              </p>
              <textarea
                className="min-h-20 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm leading-6 text-zinc-100 outline-none transition focus:border-teal-300"
                onChange={(event) =>
                  updateSegment(segment.id, event.target.value)
                }
                value={segment.text}
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
