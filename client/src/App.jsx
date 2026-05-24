import {
  SignIn,
  SignUp,
  SignOutButton,
  UserButton,
  useAuth,
  useUser
} from "@clerk/react";
import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes
} from "react-router-dom";
import ExportPanel from "./components/ExportPanel.jsx";
import ImportPanel from "./components/ImportPanel.jsx";
import Timeline from "./components/Timeline.jsx";
import TranscriptTranslatePanel from "./components/TranscriptTranslatePanel.jsx";
import TTSPanel from "./components/TTSPanel.jsx";
import VideoPreview from "./components/VideoPreview.jsx";
import { apiBaseUrl } from "./api.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isApproved(user) {
  return (
    user?.publicMetadata?.approved === true ||
    user?.unsafeMetadata?.approved === true
  );
}

function isAdmin(user) {
  return (
    user?.publicMetadata?.role === "admin" ||
    user?.unsafeMetadata?.role === "admin"
  );
}

export function showToast(message, type = "info") {
  window.dispatchEvent(
    new CustomEvent("dubsync:toast", { detail: { message, type } })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-teal-400 font-bold text-zinc-950">
        DS
      </div>
      <span className="text-xl font-semibold text-zinc-50">DubSync</span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 text-zinc-50">
      <div className="flex items-center gap-3 text-sm text-zinc-400">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-teal-400" />
        Chargement...
      </div>
    </main>
  );
}

function Dialog({ title, children, onClose }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl">
        {title ? (
          <h2 className="mb-4 text-base font-semibold text-zinc-50">{title}</h2>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function SaveDialog({ defaultName, onSave, onClose, title = "Sauvegarder le projet" }) {
  const [name, setName] = useState(defaultName || "");
  const inputRef = useRef(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSave(trimmed);
  };

  return (
    <Dialog onClose={onClose} title={title}>
      <form onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="w-full rounded-xl border border-white/10 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-50 outline-none placeholder:text-zinc-500 transition focus:border-teal-400"
          onChange={(e) => setName(e.target.value)}
          placeholder="Nom du projet"
          value={name}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-full px-4 py-2 text-sm font-medium text-zinc-400 transition hover:text-zinc-100"
            onClick={onClose}
            type="button"
          >
            Annuler
          </button>
          <button
            className="rounded-full bg-teal-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!name.trim()}
            type="submit"
          >
            Sauvegarder
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function OpenDialog({ isLoading, onClose, onSelect, projects }) {
  return (
    <Dialog onClose={onClose} title="Ouvrir un projet">
      {isLoading ? (
        <div className="flex items-center gap-3 py-6 text-sm text-zinc-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-teal-300" />
          Chargement des projets...
        </div>
      ) : projects.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400">
          Aucun projet sauvegardé.
        </p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {projects.map((project) => (
            <button
              className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition hover:bg-white/5"
              key={project.projectId}
              onClick={() => onSelect(project)}
              type="button"
            >
              <span className="text-sm font-medium text-zinc-100">
                {project.projectName}
              </span>
              <span className="ml-4 shrink-0 text-xs text-zinc-500">
                {new Date(project.savedAt).toLocaleDateString("fr-FR")}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button
          className="rounded-full px-4 py-2 text-sm font-medium text-zinc-400 transition hover:text-zinc-100"
          onClick={onClose}
          type="button"
        >
          Fermer
        </button>
      </div>
    </Dialog>
  );
}

function ConfirmDialog({ confirmLabel = "Confirmer", danger = false, message, onClose, onConfirm }) {
  return (
    <Dialog onClose={onClose} title="Confirmation">
      <p className="text-sm leading-6 text-zinc-300">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          className="rounded-full px-4 py-2 text-sm font-medium text-zinc-400 transition hover:text-zinc-100"
          onClick={onClose}
          type="button"
        >
          Annuler
        </button>
        <button
          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
            danger
              ? "bg-red-600 text-white hover:bg-red-500"
              : "bg-teal-400 text-zinc-950 hover:bg-teal-300"
          }`}
          onClick={() => {
            onConfirm();
            onClose();
          }}
          type="button"
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

function InviteDialog({ onClose, onInvite }) {
  const [email, setEmail] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmed = email.trim();

    if (trimmed) {
      onInvite(trimmed);
    }
  };

  return (
    <Dialog onClose={onClose} title="Inviter un utilisateur">
      <form onSubmit={handleSubmit}>
        <label className="block text-sm font-medium text-zinc-300" htmlFor="invite-email">
          Email
        </label>
        <input
          id="invite-email"
          ref={inputRef}
          className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-50 outline-none placeholder:text-zinc-500 transition focus:border-teal-400"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="utilisateur@example.com"
          type="email"
          value={email}
        />
        <p className="mt-3 text-xs leading-5 text-zinc-500">
          Clerk enverra un email d'invitation. L'utilisateur restera en attente
          jusqu'à approbation dans DubSync.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-full px-4 py-2 text-sm font-medium text-zinc-400 transition hover:text-zinc-100"
            onClick={onClose}
            type="button"
          >
            Annuler
          </button>
          <button
            className="rounded-full bg-teal-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!email.trim()}
            type="submit"
          >
            Envoyer l'invitation
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ToastHost() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const onToast = (event) => {
      const id = crypto.randomUUID();
      const type = event.detail.type ?? "info";
      setToasts((current) => [
        ...current,
        { id, message: event.detail.message, type }
      ]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
      }, 5000);
    };

    window.addEventListener("dubsync:toast", onToast);
    return () => window.removeEventListener("dubsync:toast", onToast);
  }, []);

  const typeConfig = {
    error: {
      border: "border-red-900",
      bg: "bg-red-950",
      text: "text-red-100",
      icon: "✕"
    },
    success: {
      border: "border-teal-900",
      bg: "bg-teal-950",
      text: "text-teal-100",
      icon: "✓"
    },
    warning: {
      border: "border-amber-800",
      bg: "bg-amber-950",
      text: "text-amber-100",
      icon: "⚠"
    },
    info: {
      border: "border-zinc-700",
      bg: "bg-zinc-900",
      text: "text-zinc-100",
      icon: "ℹ"
    }
  };

  return (
    <div className="fixed right-4 top-4 z-50 w-80 space-y-2">
      {toasts.map((toast) => {
        const config = typeConfig[toast.type] ?? typeConfig.info;
        return (
          <div
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl ${config.border} ${config.bg} ${config.text}`}
            key={toast.id}
          >
            <span className="mt-0.5 shrink-0 text-xs font-bold opacity-60">
              {config.icon}
            </span>
            <span className="leading-5">{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Route guards
// ─────────────────────────────────────────────────────────────────────────────

function HomeRedirect() {
  const { isLoaded, isSignedIn, user } = useUser();

  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <Navigate replace to="/login" />;
  return <Navigate replace to={isApproved(user) ? "/app" : "/pending"} />;
}

function LoginPage() {
  const { isLoaded, isSignedIn, user } = useUser();

  if (!isLoaded) return <LoadingScreen />;
  if (isSignedIn) {
    return <Navigate replace to={isApproved(user) ? "/app" : "/pending"} />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 py-12 text-zinc-50">
      <section className="flex w-full max-w-md flex-col items-center gap-8">
        <Logo />
        <SignIn
          fallbackRedirectUrl="/app"
          path="/login"
          routing="path"
          signUpUrl="/signup"
        />
      </section>
    </main>
  );
}

function SignUpPage() {
  const { isLoaded, isSignedIn, user } = useUser();

  if (!isLoaded) return <LoadingScreen />;
  if (isSignedIn) {
    return <Navigate replace to={isApproved(user) ? "/app" : "/pending"} />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 py-12 text-zinc-50">
      <section className="flex w-full max-w-md flex-col items-center gap-8">
        <Logo />
        <SignUp
          fallbackRedirectUrl="/pending"
          path="/signup"
          routing="path"
          signInUrl="/login"
        />
      </section>
    </main>
  );
}

function PendingPage() {
  const { isLoaded, isSignedIn, user } = useUser();

  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <Navigate replace to="/login" />;
  if (isApproved(user)) return <Navigate replace to="/app" />;

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 px-6 text-zinc-50">
      <section className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center shadow-xl shadow-black/20">
        <div className="mx-auto mb-8 w-fit">
          <Logo />
        </div>
        <h1 className="text-2xl font-semibold">Accès en attente d'approbation</h1>
        <p className="mt-4 text-sm leading-6 text-zinc-300">
          Ton compte DubSync est connecté, mais il doit encore être approuvé par
          un administrateur avant d'accéder à l'application.
        </p>
        <SignOutButton>
          <button className="mt-8 rounded-full bg-zinc-50 px-5 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-200">
            Se déconnecter
          </button>
        </SignOutButton>
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AppPage
// ─────────────────────────────────────────────────────────────────────────────

function AppPage() {
  const { getToken } = useAuth();
  const { isLoaded, isSignedIn, user } = useUser();

  const [importResult, setImportResult] = useState(null);
  const [transcriptSegments, setTranscriptSegments] = useState([]);
  const [ttsSegments, setTtsSegments] = useState([]);
  const [volumeOV, setVolumeOV] = useState(30);
  const [volumeDUB, setVolumeDUB] = useState(100);
  const [voiceName, setVoiceName] = useState("");
  const [targetLang, setTargetLang] = useState("fr-FR");
  const [ttsProvider, setTtsProvider] = useState("chirp3");
  const [currentProject, setCurrentProject] = useState(null);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState("");
  const [activePhase, setActivePhase] = useState("import");

  // Dialog states
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [openDialogProjects, setOpenDialogProjects] = useState([]);
  const [openDialogLoading, setOpenDialogLoading] = useState(false);
  const [confirmNewDubOpen, setConfirmNewDubOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);

  const apiRequest = useCallback(
    async (config) => {
      const token = await getToken();
      return axios({
        baseURL: apiBaseUrl,
        ...config,
        headers: {
          Authorization: `Bearer ${token}`,
          ...config.headers
        }
      });
    },
    [getToken]
  );

  const buildProjectState = useCallback(
    () => ({
      importResult,
      jobId: importResult?.jobId,
      targetLang,
      ttsProvider,
      transcriptSegments,
      translation: transcriptSegments.map((segment) => ({
        id: segment.id,
        translatedText: segment.translatedText || ""
      })),
      ttsSegments,
      voiceName,
      volumeDUB,
      volumeOV
    }),
    [
      importResult,
      targetLang,
      ttsProvider,
      transcriptSegments,
      ttsSegments,
      voiceName,
      volumeDUB,
      volumeOV
    ]
  );

  const currentSnapshot = JSON.stringify(buildProjectState());
  const isModified = currentSnapshot !== lastSavedSnapshot;
  const saveStatus = currentProject
    ? isModified
      ? "Modifié"
      : "Sauvegardé"
    : "Non sauvegardé";

  const saveProject = useCallback(
    async (projectName) => {
      if (!importResult?.jobId) {
        showToast("Importe une vidéo avant de sauvegarder.", "warning");
        return null;
      }

      const response = await apiRequest({
        method: "POST",
        url: "/api/project/save",
        data: {
          jobId: importResult.jobId,
          projectName,
          state: buildProjectState()
        }
      });

      setCurrentProject({
        projectId: response.data.projectId,
        projectName,
        savedAt: response.data.savedAt
      });
      setLastSavedSnapshot(JSON.stringify(buildProjectState()));
      return response.data;
    },
    [apiRequest, buildProjectState, importResult?.jobId]
  );

  const handleSave = useCallback(() => {
    setSaveDialogOpen(true);
  }, []);

  const handleSaveConfirm = async (projectName) => {
    setSaveDialogOpen(false);
    try {
      await saveProject(projectName);
      showToast(`Projet "${projectName}" sauvegardé.`, "success");
    } catch {
      showToast("Sauvegarde impossible.", "error");
    }
  };

  const handleOpen = async () => {
    setOpenDialogOpen(true);
    setOpenDialogLoading(true);
    setOpenDialogProjects([]);
    try {
      const response = await apiRequest({ method: "GET", url: "/api/project/list" });
      setOpenDialogProjects(response.data.projects);
    } catch {
      showToast("Impossible de charger les projets.", "error");
      setOpenDialogOpen(false);
    } finally {
      setOpenDialogLoading(false);
    }
  };

  const handleOpenSelect = async (project) => {
    setOpenDialogOpen(false);
    try {
      const projectResponse = await apiRequest({
        method: "GET",
        url: `/api/project/${project.projectId}`
      });
      const { state } = projectResponse.data;

      setImportResult(state.importResult ?? null);
      setTranscriptSegments(state.transcriptSegments ?? []);
      setTtsSegments(state.ttsSegments ?? []);
      setVolumeOV(state.volumeOV ?? 30);
      setVolumeDUB(state.volumeDUB ?? 100);
      setVoiceName(state.voiceName ?? "");
      setTargetLang(state.targetLang ?? "fr-FR");
      setTtsProvider(state.ttsProvider ?? "chirp3");
      setCurrentProject({
        projectId: projectResponse.data.projectId,
        projectName: projectResponse.data.projectName,
        savedAt: projectResponse.data.savedAt
      });
      setLastSavedSnapshot(JSON.stringify(state));
      setActivePhase("transcribe");
      showToast(`Projet "${project.projectName}" ouvert.`, "success");
    } catch {
      showToast("Impossible d'ouvrir ce projet.", "error");
    }
  };

  const resetProject = () => {
    setImportResult(null);
    setTranscriptSegments([]);
    setTtsSegments([]);
    setVolumeOV(30);
    setVolumeDUB(100);
    setVoiceName("");
    setTargetLang("fr-FR");
    setTtsProvider("chirp3");
    setCurrentProject(null);
    setLastSavedSnapshot("");
    setActivePhase("import");
  };

  const handleNewDub = () => {
    if (isModified) {
      setConfirmNewDubOpen(true);
    } else {
      resetProject();
    }
  };

  const editProjectName = () => {
    setRenameDialogOpen(true);
  };

  const handleRenameConfirm = (nextName) => {
    setRenameDialogOpen(false);
    setCurrentProject((project) => ({
      projectId: project?.projectId,
      projectName: nextName,
      savedAt: project?.savedAt
    }));
  };

  const handleTtsSettingsChange = useCallback(
    ({ targetLang: nextTargetLang, ttsProvider: nextTtsProvider, voiceName: nextVoiceName }) => {
      setTargetLang((current) =>
        current === nextTargetLang ? current : nextTargetLang
      );
      setTtsProvider((current) =>
        current === nextTtsProvider ? current : nextTtsProvider
      );
      if (nextVoiceName) {
        setVoiceName((current) =>
          current === nextVoiceName ? current : nextVoiceName
        );
      }
    },
    []
  );

  useEffect(() => {
    if (!currentProject || !isModified) return undefined;
    const interval = window.setInterval(() => {
      saveProject(currentProject.projectName).catch(() => {});
    }, 120000);
    return () => window.clearInterval(interval);
  }, [currentProject, isModified, saveProject]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <Navigate replace to="/login" />;
  if (!isApproved(user)) return <Navigate replace to="/pending" />;

  const phaseAvailability = {
    import: true,
    transcribe: Boolean(importResult),
    dub: transcriptSegments.length > 0,
    export: ttsSegments.length > 0
  };

  const phaseCompletion = {
    import: Boolean(importResult),
    transcribe: transcriptSegments.length > 0,
    dub: ttsSegments.length > 0,
    export: false
  };

  const phases = [
    {
      id: "import",
      index: "1",
      label: "Importation",
      detail: importResult
        ? importResult.videoName || "Vidéo chargée"
        : "Fichier source"
    },
    {
      id: "transcribe",
      index: "2",
      label: "Transcription & traduction",
      detail:
        transcriptSegments.length > 0
          ? `${transcriptSegments.length} segments`
          : "Texte source et cible"
    },
    {
      id: "dub",
      index: "3",
      label: "Doublage & affinage",
      detail:
        ttsSegments.length > 0
          ? `${ttsSegments.length} segments DUB`
          : "Voix, volumes, timeline"
    },
    {
      id: "export",
      index: "4",
      label: "Export final",
      detail: currentProject?.projectName || "MP4 final"
    }
  ];

  const currentPhaseIndex = phases.findIndex((p) => p.id === activePhase);
  const nextPhase = phases[currentPhaseIndex + 1];
  const canAdvance = nextPhase && phaseAvailability[nextPhase.id];
  const phaseTitle = phases.find((p) => p.id === activePhase)?.label;

  return (
    <main className="studio-shell min-h-screen text-zinc-50">
      {saveDialogOpen ? (
        <SaveDialog
          defaultName={currentProject?.projectName || "DubSync Project"}
          onClose={() => setSaveDialogOpen(false)}
          onSave={handleSaveConfirm}
        />
      ) : null}

      {openDialogOpen ? (
        <OpenDialog
          isLoading={openDialogLoading}
          onClose={() => setOpenDialogOpen(false)}
          onSelect={handleOpenSelect}
          projects={openDialogProjects}
        />
      ) : null}

      {confirmNewDubOpen ? (
        <ConfirmDialog
          confirmLabel="Nouveau doublage"
          danger
          message="Créer un nouveau doublage effacera les modifications non sauvegardées."
          onClose={() => setConfirmNewDubOpen(false)}
          onConfirm={resetProject}
        />
      ) : null}

      {renameDialogOpen ? (
        <SaveDialog
          defaultName={currentProject?.projectName || "Sans titre"}
          onClose={() => setRenameDialogOpen(false)}
          onSave={handleRenameConfirm}
          title="Renommer le projet"
        />
      ) : null}

      <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between px-6 py-6">
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-400">
            DubSync Studio
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-50">
            Doublage vidéo multilingue
          </h1>
        </div>
        <div className="hidden gap-2 sm:flex">
          <span className="studio-pill">Web-app</span>
          <span className="studio-pill">Dubbing</span>
        </div>
      </div>

      <div className="studio-frame mx-auto grid min-h-[calc(100vh-128px)] w-[calc(100%-48px)] max-w-[1760px] lg:grid-cols-[290px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="studio-sidebar px-5 py-5">
          <div className="mb-8">
            <Logo />
          </div>
          <nav className="grid gap-2">
            {phases.map((phase) => {
              const isActive = activePhase === phase.id;
              const isAvailable = phaseAvailability[phase.id];
              const isCompleted = phaseCompletion[phase.id];

              return (
                <button
                  className={`studio-phase-button text-left transition ${
                    isActive
                      ? "studio-phase-button-active text-zinc-50"
                      : isAvailable
                        ? "text-zinc-400 hover:text-zinc-100"
                        : "cursor-not-allowed opacity-35"
                  }`}
                  disabled={!isAvailable}
                  key={phase.id}
                  onClick={() => isAvailable && setActivePhase(phase.id)}
                  type="button"
                >
                  <span
                    className={`studio-step-number mb-2 inline-grid h-6 w-6 place-items-center text-xs font-semibold ${
                      isCompleted && !isActive
                        ? "bg-teal-400/20 text-teal-300"
                        : "text-zinc-200"
                    }`}
                  >
                    {isCompleted && !isActive ? "✓" : phase.index}
                  </span>
                  <span className="block text-sm font-semibold">
                    {phase.label}
                  </span>
                  <span className="mt-1 block text-xs text-zinc-500">
                    {phase.detail}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main */}
        <div className="min-w-0">
          <header className="studio-header flex flex-wrap items-center justify-between gap-4 px-6 py-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-zinc-500">
                {phaseTitle}
              </p>
              <button
                className="mt-1 max-w-lg truncate text-left text-lg font-semibold text-zinc-100 transition hover:text-teal-200"
                onClick={editProjectName}
                type="button"
              >
                {currentProject?.projectName || "Sans titre"}
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  isModified
                    ? "bg-amber-300 text-zinc-950"
                    : "bg-white/10 text-zinc-200"
                }`}
              >
                {saveStatus}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="rounded-full border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-100 transition hover:border-teal-300 hover:text-teal-200"
                  onClick={handleNewDub}
                  type="button"
                >
                  Nouveau
                </button>
                <button
                  className="rounded-full border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-100 transition hover:border-teal-300 hover:text-teal-200"
                  onClick={handleOpen}
                  type="button"
                >
                  Ouvrir
                </button>
                <button
                  className="rounded-full bg-teal-400 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-300"
                  onClick={handleSave}
                  title="⌘S"
                  type="button"
                >
                  Sauvegarder
                </button>
              </div>
              <div className="flex items-center gap-3 border-l border-white/10 pl-3">
                {isAdmin(user) ? (
                  <Link
                    className="rounded-full border border-zinc-700 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-300 transition hover:border-teal-300 hover:text-teal-200"
                    to="/admin"
                  >
                    Admin
                  </Link>
                ) : null}
                <UserButton afterSignOutUrl="/login" />
              </div>
            </div>
          </header>

          <section className="studio-stage px-6 py-8">
            {activePhase === "import" ? (
              <ImportPanel
                importResult={importResult}
                onImportComplete={(result) => {
                  setImportResult(result);
                  setCurrentProject(null);
                  setLastSavedSnapshot("");
                  setActivePhase("transcribe");
                }}
              />
            ) : null}

            {activePhase === "transcribe" ? (
              <div className="space-y-6">
                <VideoPreview importResult={importResult} />
                <TranscriptTranslatePanel
                  importResult={importResult}
                  onSegmentsChange={setTranscriptSegments}
                  onTargetLangChange={setTargetLang}
                  targetLang={targetLang}
                  transcriptSegments={transcriptSegments}
                />
              </div>
            ) : null}

            {activePhase === "dub" ? (
              <div className="space-y-8">
                <TTSPanel
                  importResult={importResult}
                  onSettingsChange={handleTtsSettingsChange}
                  onTtsSegmentsChange={setTtsSegments}
                  savedTargetLang={targetLang}
                  savedTtsProvider={ttsProvider}
                  savedVoiceName={voiceName}
                  transcriptSegments={transcriptSegments}
                />
                <Timeline
                  importResult={importResult}
                  onSegmentsChange={setTtsSegments}
                  onVolumesChange={({ volumeDUB: nextDUB, volumeOV: nextOV }) => {
                    setVolumeDUB(nextDUB);
                    setVolumeOV(nextOV);
                  }}
                  ttsSegments={ttsSegments}
                  volumeDUB={volumeDUB}
                  volumeOV={volumeOV}
                />
              </div>
            ) : null}

            {activePhase === "export" ? (
              <div className="space-y-8">
                <Timeline
                  importResult={importResult}
                  onSegmentsChange={setTtsSegments}
                  onVolumesChange={({ volumeDUB: nextDUB, volumeOV: nextOV }) => {
                    setVolumeDUB(nextDUB);
                    setVolumeOV(nextOV);
                  }}
                  ttsSegments={ttsSegments}
                  volumeDUB={volumeDUB}
                  volumeOV={volumeOV}
                />
                <ExportPanel
                  importResult={importResult}
                  ttsSegments={ttsSegments}
                  volumeDUB={volumeDUB}
                  volumeOV={volumeOV}
                />
              </div>
            ) : null}

            {canAdvance ? (
              <div className="mt-8 flex justify-end">
                <button
                  className="flex items-center gap-2 rounded-full bg-teal-400 px-5 py-2.5 text-sm font-semibold text-zinc-950 shadow-lg transition hover:bg-teal-300"
                  onClick={() => setActivePhase(nextPhase.id)}
                  type="button"
                >
                  {nextPhase.label}
                  <span aria-hidden>→</span>
                </button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AdminPage
// ─────────────────────────────────────────────────────────────────────────────

const statusConfig = {
  approved: {
    label: "Approuvé",
    className: "bg-teal-950 text-teal-300 border border-teal-900"
  },
  pending: {
    label: "En attente",
    className: "bg-amber-950 text-amber-300 border border-amber-800"
  },
  blocked: {
    label: "Bloqué",
    className: "bg-red-950 text-red-300 border border-red-900"
  }
};

const publicAppUrl =
  import.meta.env.VITE_APP_PUBLIC_URL ||
  "https://florists-thomson-worcester-leadership.trycloudflare.com";

const getApprovalMessage = () =>
  `Your DubSync account has been approved.

You can now access the app here:
${publicAppUrl}`;

function AdminPage() {
  const { getToken } = useAuth();
  const { isLoaded, isSignedIn, user } = useUser();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [busyUserId, setBusyUserId] = useState(null);

  const apiRequest = useCallback(
    async (config) => {
      const token = await getToken();
      return axios({
        baseURL: apiBaseUrl,
        ...config,
        headers: {
          Authorization: `Bearer ${token}`,
          ...config.headers
        }
      });
    },
    [getToken]
  );

  const loadUsers = useCallback(async () => {
    setError("");
    setIsLoading(true);
    try {
      const response = await apiRequest({ method: "GET", url: "/api/admin/users" });
      setUsers(response.data.users);
    } catch {
      setError("Impossible de charger les utilisateurs.");
    } finally {
      setIsLoading(false);
    }
  }, [apiRequest]);

  useEffect(() => {
    if (isLoaded && isSignedIn && isApproved(user) && isAdmin(user)) {
      loadUsers();
    }
  }, [isLoaded, isSignedIn, loadUsers, user]);

  const runUserAction = async (userId, config) => {
    setError("");
    setBusyUserId(userId);
    try {
      const response = await apiRequest(config);
      if (config.method === "PATCH" && config.url?.endsWith("/approve")) {
        if (response.data.approvalEmail?.error) {
          showToast(
            `Compte approuvé, mais email non envoyé : ${response.data.approvalEmail.error}`,
            "warning"
          );
          await copyApprovalMessage(response.data.user?.email);
        } else if (response.data.approvalEmail?.skipped) {
          showToast("Compte approuvé. Email non envoyé: Resend n'est pas configuré.", "warning");
          await copyApprovalMessage(response.data.user?.email);
        } else {
          showToast("Compte approuvé et email envoyé.", "success");
        }
      }
      await loadUsers();
    } catch {
      setError("Action impossible pour cet utilisateur.");
    } finally {
      setBusyUserId(null);
    }
  };

  const inviteUser = async (emailAddress) => {
    setIsInviting(true);
    setError("");

    try {
      await apiRequest({
        method: "POST",
        url: "/api/admin/invitations",
        data: { emailAddress }
      });
      setInviteDialogOpen(false);
      showToast(`Invitation envoyée à ${emailAddress}.`, "success");
      await loadUsers();
    } catch {
      setError("Invitation impossible pour cet email.");
      showToast("Invitation impossible.", "error");
    } finally {
      setIsInviting(false);
    }
  };

  const copyApprovalMessage = async (emailAddress) => {
    try {
      await navigator.clipboard.writeText(getApprovalMessage());
      showToast(
        `Approval message copied${emailAddress ? ` for ${emailAddress}` : ""}.`,
        "success"
      );
    } catch {
      showToast("Impossible de copier le message.", "error");
    }
  };

  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <Navigate replace to="/login" />;
  if (!isApproved(user)) return <Navigate replace to="/pending" />;
  if (!isAdmin(user)) return <Navigate replace to="/app" />;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      {inviteDialogOpen ? (
        <InviteDialog
          onClose={() => {
            if (!isInviting) {
              setInviteDialogOpen(false);
            }
          }}
          onInvite={inviteUser}
        />
      ) : null}

      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <Link className="opacity-90 transition hover:opacity-100" to="/app">
          <Logo />
        </Link>
        <div className="flex items-center gap-3">
          <Link
            className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-teal-300 hover:text-teal-200"
            to="/app"
          >
            ← Retour
          </Link>
          <UserButton afterSignOutUrl="/login" />
        </div>
      </header>

      <section className="px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Administration</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Gestion des accès utilisateurs DubSync.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-full bg-teal-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isInviting}
              onClick={() => setInviteDialogOpen(true)}
              type="button"
            >
              Inviter un utilisateur
            </button>
            <button
              className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-teal-300 hover:text-teal-200"
              onClick={loadUsers}
              type="button"
            >
              Actualiser
            </button>
          </div>
        </div>

        {error ? (
          <p className="mb-4 rounded-xl border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-100">
            {error}
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-800 text-left text-sm">
            <thead className="bg-zinc-900 text-xs uppercase text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Nom</th>
                <th className="px-4 py-3 font-medium">Inscription</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-950">
              {isLoading ? (
                <tr>
                  <td className="px-4 py-6 text-zinc-400" colSpan="5">
                    <div className="flex items-center gap-3">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-teal-400" />
                      Chargement des utilisateurs...
                    </div>
                  </td>
                </tr>
              ) : null}

              {!isLoading && users.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-zinc-400" colSpan="5">
                    Aucun utilisateur.
                  </td>
                </tr>
              ) : null}

              {users.map((account) => (
                <tr className="transition hover:bg-white/[0.02]" key={account.id}>
                  <td className="px-4 py-4 text-zinc-100">
                    {account.email || "—"}
                  </td>
                  <td className="px-4 py-4 text-zinc-300">
                    {account.name || "—"}
                  </td>
                  <td className="px-4 py-4 text-zinc-400">
                    {new Date(account.createdAt).toLocaleDateString("fr-FR")}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        statusConfig[account.status]?.className ??
                        "bg-zinc-800 text-zinc-100"
                      }`}
                    >
                      {statusConfig[account.status]?.label ?? account.status}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        className="rounded-full bg-teal-400 px-3 py-1.5 text-xs font-medium text-zinc-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={busyUserId === account.id}
                        onClick={() =>
                          runUserAction(account.id, {
                            method: "PATCH",
                            url: `/api/admin/users/${account.id}/approve`
                          })
                        }
                        type="button"
                      >
                        Autoriser
                      </button>
                      <button
                        className="rounded-full border border-teal-800 px-3 py-1.5 text-xs font-medium text-teal-200 transition hover:border-teal-400 hover:text-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={account.status !== "approved"}
                        onClick={() => copyApprovalMessage(account.email)}
                        title={
                          account.status === "approved"
                            ? "Copy approval message"
                            : "Available after approval"
                        }
                        type="button"
                      >
                        Copier message
                      </button>
                      <button
                        className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100 transition hover:border-amber-400 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={busyUserId === account.id}
                        onClick={() =>
                          runUserAction(account.id, {
                            method: "PATCH",
                            url: `/api/admin/users/${account.id}/block`
                          })
                        }
                        type="button"
                      >
                        Bloquer
                      </button>
                      <button
                        className="rounded-full border border-red-900 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:border-red-500 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={busyUserId === account.id}
                        onClick={() =>
                          runUserAction(account.id, {
                            method: "DELETE",
                            url: `/api/admin/users/${account.id}`
                          })
                        }
                        type="button"
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

function App() {
  return (
    <>
      <ToastHost />
      <BrowserRouter>
        <Routes>
          <Route element={<HomeRedirect />} path="/" />
          <Route element={<LoginPage />} path="/login/*" />
          <Route element={<SignUpPage />} path="/signup/*" />
          <Route element={<PendingPage />} path="/pending" />
          <Route element={<AppPage />} path="/app" />
          <Route element={<AdminPage />} path="/admin" />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </BrowserRouter>
    </>
  );
}

export default App;
