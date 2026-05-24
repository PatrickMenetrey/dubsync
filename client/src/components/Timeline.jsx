import { useAuth } from "@clerk/react";
import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { apiBaseUrl } from "../api.js";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const basename = (filePath) => String(filePath).split(/[\\/]/).pop();

const iconClass = "h-5 w-5";

function PlayIcon() {
  return (
    <svg aria-hidden="true" className={iconClass} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" className={iconClass} fill="currentColor" viewBox="0 0 24 24">
      <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" className={iconClass} fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 6h12v12H6z" />
    </svg>
  );
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, "0");
  const remainingSeconds = (safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

export default function Timeline({
  importResult,
  onSegmentsChange,
  onVolumesChange,
  ttsSegments,
  volumeDUB = 100,
  volumeOV = 30
}) {
  const { getToken } = useAuth();
  const waveformRef = useRef(null);
  const waveSurferRef = useRef(null);
  const dragRef = useRef(null);
  const segmentsRef = useRef([]);
  const onSegmentsChangeRef = useRef(onSegmentsChange);
  const previewAudioRef = useRef(null);
  const mixRef = useRef({ audios: [], rafId: null, timeouts: [] });
  const ttsUrlCacheRef = useRef(new Map());
  const videoRef = useRef(null);
  const [segments, setSegments] = useState([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [ttsUrls, setTtsUrls] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [ovVolume, setOvVolume] = useState(volumeOV);
  const [dubVolume, setDubVolume] = useState(volumeDUB);
  const [zoom, setZoom] = useState(1);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayMode] = useState("mixed");
  const [error, setError] = useState("");
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const duration = Number(importResult?.duration ?? 0);

  const ttsById = useMemo(
    () => new Map(segments.map((segment) => [segment.id, segment])),
    [segments]
  );

  const fetchAudioUrl = async (url) => {
    const token = await getToken();
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: "blob"
    });
    return URL.createObjectURL(response.data);
  };

  const fetchMediaUrl = async (url) => {
    const token = await getToken();
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: "blob"
    });
    return URL.createObjectURL(response.data);
  };

  useEffect(() => {
    onSegmentsChangeRef.current = onSegmentsChange;
  }, [onSegmentsChange]);

  useEffect(() => {
    segmentsRef.current = ttsSegments;
    setSegments(ttsSegments);
  }, [ttsSegments]);

  useEffect(() => {
    if (!importResult?.jobId) {
      return undefined;
    }

    let isCancelled = false;
    const wantedFilenames = new Set(
      ttsSegments
        .filter((segment) => segment.audioFile)
        .map((segment) => basename(segment.audioFile))
    );

    for (const [filename, objectUrl] of ttsUrlCacheRef.current.entries()) {
      if (!wantedFilenames.has(filename)) {
        URL.revokeObjectURL(objectUrl);
        ttsUrlCacheRef.current.delete(filename);
        setTtsUrls((currentUrls) => {
          const nextUrls = { ...currentUrls };
          delete nextUrls[filename];
          return nextUrls;
        });
      }
    }

    ttsSegments
      .filter((segment) => segment.audioFile)
      .forEach((segment) => {
        const filename = basename(segment.audioFile);

        if (ttsUrlCacheRef.current.has(filename)) {
          return;
        }

        fetchAudioUrl(`${apiBaseUrl}/api/jobs/${importResult.jobId}/tts/${filename}`)
          .then((objectUrl) => {
            if (isCancelled) {
              URL.revokeObjectURL(objectUrl);
              return;
            }
            ttsUrlCacheRef.current.set(filename, objectUrl);
            setTtsUrls((currentUrls) => ({
              ...currentUrls,
              [filename]: objectUrl
            }));
          })
          .catch(() => setError("Impossible de précharger un segment doublé."));
      });

    return () => {
      isCancelled = true;
    };
  }, [importResult?.jobId, ttsSegments]);

  useEffect(
    () => () => {
      for (const objectUrl of ttsUrlCacheRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      ttsUrlCacheRef.current.clear();
      setTtsUrls({});
    },
    [importResult?.jobId]
  );

  useEffect(() => {
    setOvVolume(volumeOV);
  }, [volumeOV]);

  useEffect(() => {
    setDubVolume(volumeDUB);
  }, [volumeDUB]);

  useEffect(() => {
    if (!importResult?.jobId || !waveformRef.current) {
      return undefined;
    }

    let objectUrl;
    let isMounted = true;
    const waveSurfer = WaveSurfer.create({
      barGap: 2,
      barRadius: 2,
      barWidth: 2,
      container: waveformRef.current,
      height: 96,
      progressColor: "#2dd4bf",
      waveColor: "#3f3f46"
    });

    waveSurferRef.current = waveSurfer;
    waveSurfer.setVolume(ovVolume / 100);
    waveSurfer.on("ready", () => {
      if (isMounted) {
        setIsReady(true);
      }
    });
    waveSurfer.on("play", () => {
      setIsPlaying(true);
      if (videoRef.current) {
        videoRef.current.currentTime = waveSurfer.getCurrentTime();
        videoRef.current.muted = true;
        videoRef.current.volume = 0;
        videoRef.current.play().catch(() => {});
      }
    });
    waveSurfer.on("pause", () => {
      setIsPlaying(false);
      videoRef.current?.pause();
    });
    waveSurfer.on("finish", () => {
      setIsPlaying(false);
      stopMixed();
      videoRef.current?.pause();
    });
    waveSurfer.on("seeking", (time) => {
      if (videoRef.current) {
        videoRef.current.currentTime = time;
      }
    });
    waveSurfer.on("audioprocess", (time) => {
      if (
        videoRef.current &&
        Math.abs(videoRef.current.currentTime - time) > 0.35
      ) {
        videoRef.current.currentTime = time;
      }
    });
    fetchAudioUrl(`${apiBaseUrl}/api/jobs/${importResult.jobId}/audio`)
      .then((url) => {
        objectUrl = url;
        waveSurfer.load(url);
      })
      .catch(() => setError("Impossible de charger la piste originale."));

    return () => {
      isMounted = false;
      waveSurfer.destroy();
      waveSurferRef.current = null;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [importResult?.jobId]);

  useEffect(() => {
    if (!importResult?.jobId) {
      setVideoUrl("");
      return undefined;
    }

    let objectUrl = "";
    let isMounted = true;

    fetchMediaUrl(`${apiBaseUrl}/api/jobs/${importResult.jobId}/video`)
      .then((url) => {
        objectUrl = url;
        if (isMounted) {
          setVideoUrl(url);
        }
      })
      .catch(() => setError("Impossible de charger la vidéo originale."));

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [importResult?.jobId]);

  useEffect(() => {
    waveSurferRef.current?.setVolume(ovVolume / 100);
    onVolumesChange?.({ volumeDUB: dubVolume, volumeOV: ovVolume });
  }, [ovVolume]);

  useEffect(() => {
    onVolumesChange?.({ volumeDUB: dubVolume, volumeOV: ovVolume });
  }, [dubVolume]);

  const updateSegment = (segmentId, updater) => {
    setSegments((currentSegments) => {
      const nextSegments = currentSegments.map((segment) =>
        segment.id === segmentId ? updater(segment) : segment
      );
      segmentsRef.current = nextSegments;
      return nextSegments;
    });
  };

  const applySegments = (nextSegments) => {
    segmentsRef.current = nextSegments;
    setSegments(nextSegments);
    onSegmentsChange?.(nextSegments);
  };

  const pushHistory = (snapshot) => {
    setUndoStack((currentStack) => [...currentStack.slice(-19), snapshot]);
    setRedoStack([]);
  };

  const undo = () => {
    setUndoStack((currentUndoStack) => {
      if (currentUndoStack.length === 0) {
        return currentUndoStack;
      }

      const previousSegments = currentUndoStack[currentUndoStack.length - 1];
      setRedoStack((currentRedoStack) => [
        ...currentRedoStack.slice(-19),
        segments
      ]);
      applySegments(previousSegments);
      return currentUndoStack.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((currentRedoStack) => {
      if (currentRedoStack.length === 0) {
        return currentRedoStack;
      }

      const nextSegments = currentRedoStack[currentRedoStack.length - 1];
      setUndoStack((currentUndoStack) => [
        ...currentUndoStack.slice(-19),
        segments
      ]);
      applySegments(nextSegments);
      return currentRedoStack.slice(0, -1);
    });
  };

  const deleteSelectedSegment = () => {
    if (!selectedId) {
      return;
    }

    pushHistory(segments);
    applySegments(segments.filter((segment) => segment.id !== selectedId));
    setSelectedId(null);
  };

  const startDrag = (event, segment, mode) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      duration: segment.end - segment.start,
      id: segment.id,
      mode,
      snapshot: segments,
      start: segment.start,
      startX: event.clientX,
      timelineWidth: event.currentTarget.closest("[data-timeline]").clientWidth
    };
  };

  useEffect(() => {
    const onMove = (event) => {
      if (!dragRef.current || !duration) {
        return;
      }

      const drag = dragRef.current;
      const deltaSeconds =
        ((event.clientX - drag.startX) / drag.timelineWidth) * duration;

      updateSegment(drag.id, (segment) => {
        if (drag.mode === "resize") {
          const nextEnd = clamp(
            drag.start + drag.duration + deltaSeconds,
            segment.start + 0.25,
            duration
          );
          return { ...segment, end: nextEnd };
        }

        const nextStart = clamp(
          drag.start + deltaSeconds,
          0,
          duration - drag.duration
        );
        return { ...segment, end: nextStart + drag.duration, start: nextStart };
      });
    };
    const onUp = () => {
      if (dragRef.current) {
        pushHistory(dragRef.current.snapshot);
        onSegmentsChangeRef.current?.(segmentsRef.current);
      }
      dragRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [duration]);

  const playPause = () => {
    const waveSurfer = waveSurferRef.current;

    if (!waveSurfer) {
      return;
    }

    if (waveSurfer.isPlaying()) {
      waveSurfer.pause();
      videoRef.current?.pause();
      return;
    }

    if (videoRef.current) {
      videoRef.current.currentTime = waveSurfer.getCurrentTime();
      videoRef.current.muted = true;
      videoRef.current.volume = 0;
    }
    waveSurfer.play();
  };

  const playSegmentPreview = async (segment) => {
    try {
      const filename = basename(segment.audioFile);
      const audioUrl = ttsUrls[filename] || ttsUrlCacheRef.current.get(filename);

      if (!audioUrl) {
        setError("Le segment doublé charge encore. Réessaie dans une seconde.");
        return;
      }

      previewAudioRef.current?.pause();
      previewAudioRef.current = null;
      previewAudioRef.current = new Audio(audioUrl);
      previewAudioRef.current.volume = dubVolume / 100;
      await previewAudioRef.current.play();
    } catch {
      setError("Impossible de lire ce segment doublé.");
    }
  };

  const stopMixed = () => {
    if (mixRef.current.rafId) {
      cancelAnimationFrame(mixRef.current.rafId);
    }
    mixRef.current.timeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    mixRef.current.audios.forEach((audio) => {
      audio.pause();
    });
    mixRef.current = { audios: [], rafId: null, timeouts: [] };
  };

  const stopTransport = () => {
    stopMixed();
    waveSurferRef.current?.pause();
    videoRef.current?.pause();
  };

  const stopAndRewind = () => {
    stopTransport();
    waveSurferRef.current?.seekTo(0);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.muted = true;
      videoRef.current.volume = 0;
    }
    setIsPlaying(false);
  };

  const playMixed = async () => {
    const currentSegments = segmentsRef.current;
    if (!importResult?.jobId || currentSegments.length === 0) {
      return;
    }

    try {
      stopMixed();

      const waveSurfer = waveSurferRef.current;
      const cursor = waveSurfer?.getCurrentTime() ?? 0;
      const playableSegments = currentSegments.filter(
        (segment) => segment.audioFile && segment.end > cursor
      );

      if (playableSegments.length === 0) {
        setError("Aucun segment doublé à lire à partir de cette position.");
        return;
      }

      const missingSegments = playableSegments.filter((segment) => {
        const filename = basename(segment.audioFile);
        return !ttsUrls[filename] && !ttsUrlCacheRef.current.has(filename);
      });

      if (missingSegments.length > 0) {
        setError("Les segments doublés chargent encore. Réessaie dans une seconde.");
        return;
      }

      const audioEntries = playableSegments.map((segment) => {
        const filename = basename(segment.audioFile);
        const objectUrl = ttsUrls[filename] || ttsUrlCacheRef.current.get(filename);
        const audio = new Audio(objectUrl);
        audio.preload = "auto";
        audio.volume = dubVolume / 100;
        const targetDuration = Math.max(0.25, segment.end - segment.start);
        const generatedDuration = Number(segment.duration) || targetDuration;
        audio.playbackRate = clamp(generatedDuration / targetDuration, 0.75, 1.35);
        audio.load();
        return {
          audio,
          segment,
          startsAfterPlaybackCursor: segment.start >= cursor
        };
      });

      waveSurfer?.setVolume(ovVolume / 100);

      if (videoRef.current) {
        videoRef.current.currentTime = cursor;
        videoRef.current.muted = true;
        videoRef.current.volume = 0;
      }

      mixRef.current.audios = audioEntries.map((entry) => entry.audio);
      await waveSurfer?.play();

      const scheduleDub = () => {
        const currentTime = waveSurfer?.getCurrentTime() ?? 0;
        let hasPendingAudio = false;
        const startLookAheadSeconds = 0.08;

        audioEntries.forEach((entry) => {
          const { audio, segment } = entry;

          if (entry.started || entry.scheduled || currentTime >= segment.end) {
            return;
          }

          hasPendingAudio = true;

          if (currentTime + startLookAheadSeconds >= segment.start) {
            entry.scheduled = true;
            const startDelayMs = Math.max(0, (segment.start - currentTime) * 1000);
            const startTimeout = window.setTimeout(() => {
              entry.started = true;
              audio.currentTime = 0;
              audio.play().catch(() => {
                setError("Lecture du doublage bloquée par le navigateur.");
              });
            }, startDelayMs);
            const stopDelayMs =
              startDelayMs + Math.max(80, (segment.end - segment.start) * 1000);
            const stopTimeout = window.setTimeout(() => {
              audio.pause();
            }, stopDelayMs);
            mixRef.current.timeouts.push(startTimeout);
            mixRef.current.timeouts.push(stopTimeout);
          }
        });

        if (waveSurfer?.isPlaying() && hasPendingAudio) {
          mixRef.current.rafId = requestAnimationFrame(scheduleDub);
          return;
        }

        mixRef.current.rafId = null;
      };

      scheduleDub();
    } catch {
      setError("Impossible de lire la piste doublée.");
    }
  };

  const toggleTransport = () => {
    const waveSurfer = waveSurferRef.current;

    if (waveSurfer?.isPlaying()) {
      stopTransport();
      return;
    }

    if (playMode === "mixed") {
      playMixed();
      return;
    }

    playPause();
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }

      if (!isTyping && event.key === " ") {
        event.preventDefault();
        toggleTransport();
        return;
      }

      if (!isTyping && event.key === "Delete") {
        event.preventDefault();
        deleteSelectedSegment();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [segments, selectedId, playMode, ttsUrls, isReady]);

  useEffect(
    () => () => {
      stopMixed();
      previewAudioRef.current?.pause();
    },
    []
  );
  if (!importResult || !duration) {
    return null;
  }

  return (
    <section className="mx-auto max-w-6xl rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-50">Timeline</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Vidéo source, waveform OV et segments DUB synchronisés.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex rounded-full border border-white/10 bg-black/25 p-1">
            <button
              className={`rounded-full px-4 py-2 font-medium transition ${
                playMode === "ov"
                  ? "bg-teal-300 text-zinc-950"
                  : "text-zinc-300 hover:text-zinc-50"
              }`}
              onClick={() => setPlayMode("ov")}
              type="button"
            >
              OV
            </button>
            <button
              className={`rounded-full px-4 py-2 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                playMode === "mixed"
                  ? "bg-teal-300 text-zinc-950"
                  : "text-zinc-300 hover:text-zinc-50"
              }`}
              disabled={segments.length === 0}
              onClick={() => setPlayMode("mixed")}
              type="button"
            >
              Mixée
            </button>
          </div>
          <button
            aria-label={isPlaying ? "Pause" : "Lecture"}
            className="grid h-11 w-11 place-items-center rounded-full bg-teal-400 text-zinc-950 transition hover:bg-teal-300 disabled:opacity-50"
            disabled={!isReady || (playMode === "mixed" && segments.length === 0)}
            onClick={toggleTransport}
            type="button"
            title={isPlaying ? "Pause" : "Lecture"}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            aria-label="Stop et retour au début"
            className="grid h-11 w-11 place-items-center rounded-full border border-zinc-700 text-zinc-200 transition hover:border-zinc-400 hover:text-zinc-50"
            onClick={stopAndRewind}
            type="button"
            title="Stop et retour au début"
          >
            <StopIcon />
          </button>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-md border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-black">
          {videoUrl ? (
            <video
              className="aspect-video w-full bg-black"
              muted
              playsInline
              onPlay={() => {
                if (videoRef.current) {
                  videoRef.current.muted = true;
                  videoRef.current.volume = 0;
                }
              }}
              onVolumeChange={() => {
                if (videoRef.current && !videoRef.current.muted) {
                  videoRef.current.muted = true;
                  videoRef.current.volume = 0;
                }
              }}
              ref={videoRef}
              src={videoUrl}
            />
          ) : (
            <div className="grid aspect-video place-items-center text-sm text-zinc-500">
              Chargement vidéo...
            </div>
          )}
        </div>
        <div className="grid content-end gap-4 md:grid-cols-3">
        <label className="text-sm text-zinc-300">
          Volume OV {ovVolume}%
          <input
            className="mt-2 block w-full accent-teal-300"
            max="100"
            min="0"
            onChange={(event) => setOvVolume(Number(event.target.value))}
            type="range"
            value={ovVolume}
          />
        </label>
        <label className="text-sm text-zinc-300">
          Volume DUB {dubVolume}%
          <input
            className="mt-2 block w-full accent-teal-300"
            max="100"
            min="0"
            onChange={(event) => setDubVolume(Number(event.target.value))}
            type="range"
            value={dubVolume}
          />
        </label>
        <p className="self-end text-sm text-zinc-500">
          Molette sur la timeline pour zoomer.
        </p>
        </div>
      </div>

      <div
        className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950"
        onWheel={(event) => {
          event.preventDefault();
          setZoom((currentZoom) =>
            clamp(currentZoom + (event.deltaY > 0 ? -0.2 : 0.2), 1, 6)
          );
        }}
      >
        <div
          className="min-h-64 p-4"
          data-timeline
          style={{ minWidth: `${zoom * 100}%` }}
        >
          <div className="mb-2 text-xs font-semibold uppercase text-zinc-500">
            OV
          </div>
          <div ref={waveformRef} />

          <div className="mb-2 mt-8 text-xs font-semibold uppercase text-zinc-500">
            DUB
          </div>
          <div className="relative h-28 rounded-md bg-zinc-900">
            {segments.length === 0 ? (
              <div className="grid h-full place-items-center text-sm text-zinc-500">
                Les segments doublés apparaîtront ici après génération TTS.
              </div>
            ) : null}
            {segments.map((segment) => {
              const filename = basename(segment.audioFile);
              const isAudioReady = Boolean(ttsUrls[filename]);
              const left = `${(segment.start / duration) * 100}%`;
              const width = `${((segment.end - segment.start) / duration) * 100}%`;
              const isSelected = selectedId === segment.id;

              return (
                <div
                  className={`absolute top-4 h-20 cursor-grab rounded-md border px-2 py-2 text-xs shadow-lg ${
                    isSelected
                      ? "border-teal-200 bg-teal-400 text-zinc-950"
                      : "border-teal-700 bg-teal-900 text-teal-50"
                  }`}
                  key={segment.id}
                  onClick={() => {
                    setSelectedId(segment.id);
                  }}
                  onDoubleClick={() => {
                    pushHistory(segments);
                    setEditingId(segment.id);
                  }}
                  onMouseDown={(event) => startDrag(event, segment, "move")}
                  style={{ left, width }}
                  title={`${formatTime(segment.start)} - ${formatTime(segment.end)}`}
                >
                  <button
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/30 text-xs"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      pushHistory(segments);
                      applySegments(
                        segments.filter((item) => item.id !== segment.id)
                      );
                    }}
                    type="button"
                  >
                    ×
                  </button>
                  <button
                    className="absolute left-1 top-1 rounded bg-black/30 px-2 py-1 text-[10px] font-semibold uppercase disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!isAudioReady}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(segment.id);
                      playSegmentPreview(segment);
                    }}
                    type="button"
                  >
                    Play
                  </button>
                  {editingId === segment.id ? (
                    <input
                      autoFocus
                      className="mt-5 w-full rounded bg-zinc-950/80 px-2 py-1 text-zinc-50"
                      onBlur={() => setEditingId(null)}
                      onChange={(event) => {
                        const newText = event.target.value;
                        applySegments(
                          segments.map((s) =>
                            s.id === segment.id ? { ...s, text: newText } : s
                          )
                        );
                      }}
                      onClick={(event) => event.stopPropagation()}
                      value={ttsById.get(segment.id)?.text ?? ""}
                    />
                  ) : (
                    <p className="mt-5 truncate pr-4">
                      {segment.text || segment.id}
                    </p>
                  )}
                  <span
                    className="absolute bottom-0 right-0 h-full w-3 cursor-ew-resize rounded-r-md bg-white/30"
                    onMouseDown={(event) => startDrag(event, segment, "resize")}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
