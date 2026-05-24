import { useAuth } from "@clerk/react";
import axios from "axios";
import { useEffect, useState } from "react";
import { apiBaseUrl } from "../api.js";

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

export default function TranslationPanel({
  onTargetLangChange,
  onTranslationChange,
  targetLang,
  transcriptSegments
}) {
  const { getToken } = useAuth();
  const [segments, setSegments] = useState([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSegments(transcriptSegments);
  }, [transcriptSegments]);

  const translate = async () => {
    if (transcriptSegments.length === 0) {
      return;
    }

    setError("");
    setIsTranslating(true);

    try {
      const token = await getToken();
      const response = await axios.post(
        `${apiBaseUrl}/api/translate`,
        {
          segments: transcriptSegments,
          targetLang
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      setSegments(response.data.segments);
      onTranslationChange?.(response.data.segments);
    } catch (translationError) {
      setError(
        translationError.response?.data?.error ||
          "Traduction impossible pour ces segments."
      );
    } finally {
      setIsTranslating(false);
    }
  };

  const updateSegment = (segmentId, translatedText) => {
    setSegments((currentSegments) => {
      const nextSegments = currentSegments.map((segment) =>
        segment.id === segmentId ? { ...segment, translatedText } : segment
      );
      onTranslationChange?.(nextSegments);
      return nextSegments;
    });
  };

  if (transcriptSegments.length === 0) {
    return null;
  }

  return (
    <section className="mx-auto mt-10 max-w-5xl rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-50">Traduction</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Traduis les segments avant de générer le doublage.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
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
            className="rounded-md bg-teal-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isTranslating}
            onClick={translate}
            type="button"
          >
            Traduire
          </button>
        </div>
      </div>

      {isTranslating ? (
        <div className="mt-6 flex items-center gap-3 text-sm text-zinc-300">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-teal-300" />
          <span>Traduction en cours...</span>
        </div>
      ) : null}

      {error ? (
        <p className="mt-6 rounded-md border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      <div className="mt-6 space-y-3">
        {segments.map((segment) => (
          <div
            className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4 md:grid-cols-2"
            key={segment.id}
          >
            <div>
              <p className="mb-3 text-xs font-medium text-zinc-400">
                [{formatTimestamp(segment.start)} → {formatTimestamp(segment.end)}]
              </p>
              <p className="rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm leading-6 text-zinc-300">
                {segment.text}
              </p>
            </div>
            <div>
              <p className="mb-3 text-xs font-medium text-teal-200">
                Texte traduit
              </p>
              <textarea
                className="min-h-28 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm leading-6 text-zinc-100 outline-none transition focus:border-teal-300"
                onChange={(event) =>
                  updateSegment(segment.id, event.target.value)
                }
                value={segment.translatedText ?? ""}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
