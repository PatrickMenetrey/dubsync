import { useAuth } from "@clerk/react";
import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiBaseUrl } from "../api.js";

const languages = [
  { label: "Français", value: "fr-FR" },
  { label: "Anglais US", value: "en-US" },
  { label: "Anglais UK", value: "en-GB" },
  { label: "Allemand", value: "de-DE" },
  { label: "Espagnol", value: "es-ES" },
  { label: "Italien", value: "it-IT" }
];

const ttsProviders = [
  { label: "Chirp 3 HD", value: "chirp3" },
  { label: "Google TTS", value: "google" },
  { label: "Gemini TTS", value: "gemini" }
];

const previewSamples = {
  "de-DE": "Dies ist eine Vorschau der ausgewählten DubSync-Stimme.",
  "en-GB": "This is a preview of the selected DubSync voice.",
  "en-US": "This is a preview of the selected DubSync voice.",
  "es-ES": "Esta es una vista previa de la voz seleccionada en DubSync.",
  "fr-FR": "Voici un aperçu de la voix sélectionnée dans DubSync.",
  "it-IT": "Questa è un'anteprima della voce selezionata in DubSync."
};

function languageCodeFromVoiceName(voiceName, fallbackLanguageCode) {
  const match = String(voiceName).match(/^([a-z]{2}-[A-Z]{2})-/);
  return match?.[1] ?? fallbackLanguageCode;
}

function apiErrorMessage(error, fallback) {
  if (error.response?.status === 403) {
    return error.response?.data?.error || "Accès refusé par le serveur.";
  }
  return error.response?.data?.error || fallback;
}

export default function TTSPanel({
  importResult,
  onSettingsChange,
  onTtsSegmentsChange,
  savedTargetLang,
  savedTtsProvider,
  savedVoiceName,
  transcriptSegments
}) {
  const { getToken, isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const getTokenRef = useRef(getToken);
  const [languageCode, setLanguageCode] = useState(savedTargetLang || "fr-FR");
  const [ttsProvider, setTtsProvider] = useState(savedTtsProvider || "chirp3");
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState("");
  const [ttsSegments, setTtsSegments] = useState([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [busySegmentId, setBusySegmentId] = useState(null);
  const [error, setError] = useState("");

  // Gemini voices have no language prefix — they work with any language
  const effectiveVoiceLanguage =
    ttsProvider === "gemini"
      ? languageCode
      : languageCodeFromVoiceName(voiceName, languageCode);
  const previewText =
    previewSamples[effectiveVoiceLanguage] ||
    previewSamples[languageCode] ||
    previewSamples["fr-FR"];
  const canUseVoice =
    Boolean(voiceName) && !isLoadingVoices && effectiveVoiceLanguage === languageCode;

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const usableSegments = useMemo(
    () =>
      transcriptSegments.map((segment) => ({
        ...segment,
        translatedText: segment.translatedText || segment.text
      })),
    [transcriptSegments]
  );

  const apiRequest = useCallback(async (config) => {
    const token = await getTokenRef.current();
    return axios({
      baseURL: apiBaseUrl,
      ...config,
      dubsyncSilent: true,
      headers: {
        Authorization: `Bearer ${token}`,
        ...config.headers
      }
    });
  }, []);

  const apiRequestRef = useRef(apiRequest);
  const onSettingsChangeRef = useRef(onSettingsChange);
  const savedVoiceNameRef = useRef(savedVoiceName);
  useEffect(() => { apiRequestRef.current = apiRequest; }, [apiRequest]);
  useEffect(() => { onSettingsChangeRef.current = onSettingsChange; }, [onSettingsChange]);
  useEffect(() => { savedVoiceNameRef.current = savedVoiceName; }, [savedVoiceName]);

  useEffect(() => {
    if (!importResult?.jobId || !isAuthLoaded || !isSignedIn) return;
    let cancelled = false;
    setIsLoadingVoices(true);
    setVoices([]);
    setVoiceName("");
    setError("");
    apiRequestRef.current({
      method: "GET",
      url: "/api/tts/voices",
      params: { language: languageCode, provider: ttsProvider }
    })
      .then((res) => {
        if (cancelled) return;
        const nextVoices = res.data.voices || [];
        const nextVoiceName =
          nextVoices.find((v) => v.name === savedVoiceNameRef.current)?.name ||
          nextVoices[0]?.name ||
          "";
        setVoices(nextVoices);
        setVoiceName(nextVoiceName);
        onSettingsChangeRef.current?.({ targetLang: languageCode, ttsProvider, voiceName: nextVoiceName });
        if (res.data.warning) setError(res.data.warning);
      })
      .catch((err) => {
        if (cancelled) return;
        setVoices([]);
        setVoiceName("");
        setError(apiErrorMessage(err, "Impossible de charger les voix TTS."));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingVoices(false);
      });
    return () => { cancelled = true; };
  }, [ttsProvider, languageCode, importResult?.jobId, isAuthLoaded, isSignedIn]);

  const changeProvider = (nextProvider) => {
    setTtsProvider(nextProvider);
  };

  const changeLanguage = (nextLanguageCode) => {
    setLanguageCode(nextLanguageCode);
  };

  const changeVoice = (nextVoiceName) => {
    setVoiceName(nextVoiceName);
    onSettingsChange?.({ targetLang: languageCode, ttsProvider, voiceName: nextVoiceName });
  };

  const playPreview = async () => {
    if (!voiceName) return;
    setError("");
    try {
      const response = await apiRequest({
        method: "POST",
        url: "/api/tts/preview",
        data: {
          voiceName,
          languageCode: effectiveVoiceLanguage,
          provider: ttsProvider,
          text: previewText
        }
      });
      const audio = new Audio(
        `data:${response.data.mimeType};base64,${response.data.audioContent}`
      );
      await audio.play();
    } catch (previewError) {
      setError(apiErrorMessage(previewError, "Aperçu de voix indisponible."));
    }
  };

  const generateDub = async (segments = usableSegments) => {
    if (!importResult?.jobId || !voiceName || segments.length === 0) return;

    setError("");
    setIsGenerating(true);

    try {
      const response = await apiRequest({
        method: "POST",
        url: "/api/tts/generate",
        data: {
          jobId: importResult.jobId,
          segments,
          voiceName,
          languageCode: effectiveVoiceLanguage,
          provider: ttsProvider
        }
      });
      const enrichedSegments = response.data.ttsSegments.map((segment) => {
        const sourceSegment = usableSegments.find((item) => item.id === segment.id);
        return {
          ...segment,
          text: sourceSegment?.translatedText || sourceSegment?.text || ""
        };
      });
      setTtsSegments(enrichedSegments);
      onTtsSegmentsChange?.(enrichedSegments);
      onSettingsChange?.({ targetLang: languageCode, ttsProvider, voiceName });
    } catch (generationError) {
      setError(apiErrorMessage(generationError, "Génération du doublage impossible."));
    } finally {
      setIsGenerating(false);
    }
  };

  const regenerateSegment = async (segmentId) => {
    const segment = usableSegments.find((item) => item.id === segmentId);
    if (!segment) return;

    setBusySegmentId(segmentId);

    try {
      const response = await apiRequest({
        method: "POST",
        url: "/api/tts/generate",
        data: {
          jobId: importResult.jobId,
          segments: [{ ...segment, speakingRate: 1 }],
          voiceName,
          languageCode: effectiveVoiceLanguage,
          provider: ttsProvider
        }
      });
      const [updatedSegment] = response.data.ttsSegments;
      setTtsSegments((currentSegments) => {
        const sourceSegment = usableSegments.find((item) => item.id === segmentId);
        const nextSegments = currentSegments
          .map((item) => (item.id === segmentId ? updatedSegment : item))
          .map((item) =>
            item.id === segmentId
              ? {
                  ...item,
                  text: sourceSegment?.translatedText || sourceSegment?.text || ""
                }
              : item
          );
        onTtsSegmentsChange?.(nextSegments);
        return nextSegments;
      });
    } catch (regenerationError) {
      setError(apiErrorMessage(regenerationError, "Régénération du segment impossible."));
    } finally {
      setBusySegmentId(null);
    }
  };

  if (!importResult || transcriptSegments.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-50">Doublage TTS</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Génère les pistes voix avec{" "}
            {{ chirp3: "Chirp 3 HD", google: "Google TTS", gemini: "Gemini TTS" }[ttsProvider] ?? ttsProvider}.
          </p>
        </div>

        <div className="grid w-full min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[150px_160px_minmax(220px,1fr)_110px_170px]">
          {/* Provider */}
          <select
            className="h-11 min-w-0 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            onChange={(e) => changeProvider(e.target.value)}
            value={ttsProvider}
          >
            {ttsProviders.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>

          {/* Language */}
          <select
            className="h-11 min-w-0 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            onChange={(e) => changeLanguage(e.target.value)}
            value={languageCode}
          >
            {languages.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>

          {/* Voice selector */}
          <div className="relative h-11 min-w-0">
            <select
              className="h-full w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 disabled:opacity-60"
              disabled={isLoadingVoices}
              onChange={(e) => changeVoice(e.target.value)}
              value={voiceName}
            >
              {isLoadingVoices ? (
                <option value="">Chargement des voix...</option>
              ) : voices.length === 0 ? (
                <option value="">Aucune voix disponible</option>
              ) : null}
              {voices.map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name} · {voice.gender} · {voice.type}
                </option>
              ))}
            </select>
            {isLoadingVoices ? (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-teal-300 block" />
              </span>
            ) : null}
          </div>

          {/* Preview */}
          <button
            className="h-11 min-w-0 rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-teal-300 hover:text-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canUseVoice}
            onClick={playPreview}
            type="button"
          >
            ▶ Aperçu
          </button>

          {/* Generate */}
          <button
            className="h-11 min-w-0 rounded-xl bg-teal-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canUseVoice || isGenerating}
            onClick={() => generateDub()}
            type="button"
          >
            {isGenerating ? "Génération..." : "Générer le doublage"}
          </button>

          <p className="min-w-0 text-xs leading-5 text-zinc-500 sm:col-span-2 xl:col-span-5">
            Aperçu :{" "}
            <span className="italic text-zinc-400">{previewText}</span>
          </p>
        </div>
      </div>

      {isGenerating ? (
        <div className="mt-6 flex items-center gap-3 text-sm text-zinc-300">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-teal-300" />
          <span>Génération des segments TTS...</span>
        </div>
      ) : null}

      {error ? (
        <p className="mt-6 rounded-xl border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      {ttsSegments.length > 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-100">
              {ttsSegments.length} segment{ttsSegments.length > 1 ? "s" : ""} générés
            </p>
            {ttsSegments.some((s) => s.needsSpeedAdjust) ? (
              <span className="rounded-full bg-amber-300 px-3 py-1 text-xs font-semibold text-zinc-950">
                Certains segments dépassent leur durée cible
              </span>
            ) : (
              <span className="rounded-full bg-teal-950 px-3 py-1 text-xs font-semibold text-teal-300 border border-teal-900">
                Prêt pour affinage ✓
              </span>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
