import { useAuth } from "@clerk/react";
import axios from "axios";
import { useEffect, useState } from "react";
import { apiBaseUrl } from "../api.js";

const sourceLanguages = [
  { label: "Auto", value: "" },
  { label: "Français", value: "fr" },
  { label: "Anglais", value: "en" },
  { label: "Allemand", value: "de" },
  { label: "Espagnol", value: "es" },
  { label: "Italien", value: "it" }
];

const targetLanguages = [
  { label: "Français", value: "fr-FR" },
  { label: "Anglais US", value: "en-US" },
  { label: "Anglais UK", value: "en-GB" },
  { label: "Allemand", value: "de-DE" },
  { label: "Espagnol", value: "es-ES" },
  { label: "Italien", value: "it-IT" }
];

function formatTimestamp(seconds) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, "0");
  const remainingSeconds = (safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function apiErrorMessage(error, fallback) {
  if (error.response?.status === 403) {
    return error.response?.data?.error || "Accès refusé par le serveur.";
  }

  return error.response?.data?.error || fallback;
}

export default function TranscriptTranslatePanel({
  importResult,
  onSegmentsChange,
  onTargetLangChange,
  targetLang,
  transcriptSegments
}) {
  const { getToken } = useAuth();
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [segments, setSegments] = useState([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState("");
  const usesChunking = Number(importResult?.audioSizeMb ?? 0) > 25;

  useEffect(() => {
    setSegments(transcriptSegments);
  }, [transcriptSegments]);

  const updateSegments = (nextSegments) => {
    setSegments(nextSegments);
    onSegmentsChange?.(nextSegments);
  };

  const transcribe = async () => {
    if (!importResult?.jobId) {
      return;
    }

    setError("");
    setIsTranscribing(true);

    try {
      const token = await getToken();
      const response = await axios.post(
        `${apiBaseUrl}/api/transcribe`,
        {
          jobId: importResult.jobId,
          ...(sourceLanguage ? { language: sourceLanguage } : {})
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      updateSegments(response.data.transcript);
    } catch (transcriptionError) {
      setError(
        apiErrorMessage(
          transcriptionError,
          "Transcription impossible pour ce fichier."
        )
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const translate = async () => {
    if (segments.length === 0) {
      return;
    }

    setError("");
    setIsTranslating(true);

    try {
      const token = await getToken();
      const response = await axios.post(
        `${apiBaseUrl}/api/translate`,
        {
          segments,
          targetLang
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      updateSegments(response.data.segments);
    } catch (translationError) {
      setError(
        apiErrorMessage(
          translationError,
          "Traduction impossible pour ces segments."
        )
      );
    } finally {
      setIsTranslating(false);
    }
  };

  const updateSegmentField = (segmentId, field, value) => {
    updateSegments(
      segments.map((segment) =>
        segment.id === segmentId ? { ...segment, [field]: value } : segment
      )
    );
  };

  if (!importResult) {
    return (
      <section className="mx-auto max-w-6xl rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-xl font-semibold text-zinc-50">
          Transcription traduction
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Importe une vidéo pour activer cette phase.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">
            Transcription traduction
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Texte original à gauche, traduction éditable à droite.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            <select
              aria-label="Langue source"
              className="w-36 rounded-md border border-transparent bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              disabled={isTranscribing}
              onChange={(event) => setSourceLanguage(event.target.value)}
              value={sourceLanguage}
            >
              {sourceLanguages.map((language) => (
                <option key={language.label} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
            <button
              className="rounded-md bg-teal-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isTranscribing}
              onClick={transcribe}
              type="button"
            >
              Transcrire
            </button>
          </div>
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            <select
              aria-label="Langue cible"
              className="w-40 rounded-md border border-transparent bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              disabled={isTranslating}
              onChange={(event) => onTargetLangChange?.(event.target.value)}
              value={targetLang}
            >
              {targetLanguages.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
            <button
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-teal-300 hover:text-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isTranslating || segments.length === 0}
              onClick={translate}
              type="button"
            >
              Traduire
            </button>
          </div>
        </div>
      </div>

      {isTranscribing || isTranslating ? (
        <div className="mt-6 flex items-center gap-3 text-sm text-zinc-300">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-teal-300" />
          <span>
            {isTranscribing
              ? usesChunking
                ? "Chunking et transcription en cours..."
                : "Transcription en cours..."
              : "Traduction en cours..."}
          </span>
        </div>
      ) : null}

      {error ? (
        <p className="mt-6 rounded-md border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      {segments.length === 0 ? (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">
          Lance la transcription pour générer les segments éditables.
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-zinc-800">
          <div className="grid grid-cols-[90px_1fr_1fr] border-b border-zinc-800 bg-zinc-950 px-4 py-3 text-xs font-semibold uppercase text-zinc-500">
            <span>Timecode</span>
            <span>Transcription</span>
            <span>Traduction</span>
          </div>
          <div className="divide-y divide-zinc-800">
            {segments.map((segment) => (
              <div
                className="grid gap-4 bg-zinc-950 px-4 py-4 md:grid-cols-[90px_1fr_1fr]"
                key={segment.id}
              >
                <p className="text-xs font-medium text-teal-200">
                  {formatTimestamp(segment.start)}
                  <br />
                  {formatTimestamp(segment.end)}
                </p>
                <textarea
                  className="min-h-24 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm leading-6 text-zinc-100 outline-none transition focus:border-teal-300"
                  onChange={(event) =>
                    updateSegmentField(segment.id, "text", event.target.value)
                  }
                  value={segment.text}
                />
                <textarea
                  className="min-h-24 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm leading-6 text-zinc-100 outline-none transition focus:border-teal-300"
                  onChange={(event) =>
                    updateSegmentField(
                      segment.id,
                      "translatedText",
                      event.target.value
                    )
                  }
                  placeholder="Traduction"
                  value={segment.translatedText ?? ""}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
