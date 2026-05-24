import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import axios from "axios";
import cron from "node-cron";
import { clerkClient } from "@clerk/express";
import ffmpeg from "fluent-ffmpeg";
import OpenAI from "openai";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { adminAuth } from "./middleware/adminAuth.js";
import { clerkAuth } from "./middleware/clerkAuth.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = process.env.PORT || 3001;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(currentDir, "..");
const tmpRoot = path.join(serverRoot, "tmp");
const projectsRoot = path.join(serverRoot, "projects");
const allowedVideoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm"]);
const maxVideoSizeBytes = 2 * 1024 * 1024 * 1024;
const maxTranscriptChunkMb = 24;
const exportJobs = new Map();
const tmpMaxAgeMs = 24 * 60 * 60 * 1000;
const appPublicUrl = process.env.APP_PUBLIC_URL || "";
const mailFrom = process.env.MAIL_FROM || "DubSync <onboarding@resend.dev>";

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        origin === "http://localhost:5173" ||
        origin === "http://127.0.0.1:5173" ||
        origin.endsWith(".trycloudflare.com")
      ) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    }
  })
);
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "dubsync-server" });
});

app.use("/api", clerkAuth);

app.get("/api/me", (request, response) => {
  response.json({
    userId: request.userId,
    email: request.userEmail
  });
});

app.post("/api/project/save", async (request, response) => {
  const { jobId, projectName, state } = request.body;
  const projectId = safeProjectId(projectName);

  if (!jobId || !projectId || !state) {
    response.status(400).json({ error: "jobId, projectName and state are required" });
    return;
  }

  try {
    const savedAt = new Date().toISOString();
    const userProjectsDir = path.join(projectsRoot, request.userId);
    const projectPath = getProjectPath(request.userId, projectId);

    await fs.mkdir(userProjectsDir, { recursive: true });
    await fs.writeFile(
      projectPath,
      JSON.stringify({ jobId, projectId, projectName, savedAt, state }, null, 2)
    );
    response.json({ projectId, savedAt });
  } catch (error) {
    console.error("Failed to save project", error);
    response.status(500).json({ error: "Unable to save project" });
  }
});

app.get("/api/project/list", async (request, response) => {
  const userProjectsDir = path.join(projectsRoot, request.userId);

  try {
    await fs.mkdir(userProjectsDir, { recursive: true });
    const files = await fs.readdir(userProjectsDir);
    const projects = await Promise.all(
      files
        .filter((file) => file.endsWith(".dubsync"))
        .map(async (file) => {
          const project = JSON.parse(
            await fs.readFile(path.join(userProjectsDir, file), "utf8")
          );
          return {
            jobId: project.jobId,
            projectId: project.projectId,
            projectName: project.projectName,
            savedAt: project.savedAt
          };
        })
    );

    response.json({ projects });
  } catch (error) {
    console.error("Failed to list projects", error);
    response.status(500).json({ error: "Unable to list projects" });
  }
});

app.get("/api/project/:projectId", async (request, response) => {
  const projectId = safeProjectId(request.params.projectId);

  try {
    const project = JSON.parse(
      await fs.readFile(getProjectPath(request.userId, projectId), "utf8")
    );
    response.json(project);
  } catch (error) {
    console.error("Failed to load project", error);
    response.status(404).json({ error: "Project not found" });
  }
});

const getPrimaryEmail = (user) => {
  const primaryEmail = user.emailAddresses.find(
    (emailAddress) => emailAddress.id === user.primaryEmailAddressId
  );

  return (
    primaryEmail?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null
  );
};

const getUserStatus = (user) => {
  if (user.banned) {
    return "blocked";
  }

  return user.publicMetadata?.approved === true ? "approved" : "pending";
};

const serializeUser = (user) => ({
  id: user.id,
  email: getPrimaryEmail(user),
  name:
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    "",
  createdAt: user.createdAt,
  status: getUserStatus(user)
});

const sendTransactionalEmail = async ({ html, subject, text, to }) => {
  if (!process.env.RESEND_API_KEY || !to) {
    return { skipped: true };
  }

  await axios.post(
    "https://api.resend.com/emails",
    {
      from: mailFrom,
      html,
      subject,
      text,
      to
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return { skipped: false };
};

const getPublicAppUrl = () =>
  appPublicUrl || "https://florists-thomson-worcester-leadership.trycloudflare.com";

const sendApprovalEmail = async (user) => {
  const email = getPrimaryEmail(user);
  const appUrl = getPublicAppUrl();

  return sendTransactionalEmail({
    to: email,
    subject: "Your DubSync account has been approved",
    text: `Your DubSync account has been approved.\n\nYou can now access the app here:\n${appUrl}\n`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #18181b;">
        <h1 style="font-size: 20px;">Your DubSync account has been approved</h1>
        <p>You can now access the app here:</p>
        <p>
          <a href="${appUrl}" style="color: #0f766e; font-weight: 600;">
            ${appUrl}
          </a>
        </p>
      </div>
    `
  });
};

const safeProjectId = (projectName) =>
  String(projectName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const getProjectPath = (userId, projectId) =>
  path.join(projectsRoot, userId, `${projectId}.dubsync`);

const deeplTargetFromLocale = (locale) => {
  const normalizedLocale = String(locale || "fr-FR").toUpperCase();
  const map = {
    "FR-FR": "FR",
    FR: "FR",
    "DE-DE": "DE",
    DE: "DE",
    "ES-ES": "ES",
    ES: "ES",
    "IT-IT": "IT",
    IT: "IT",
    "EN-US": "EN-US",
    "EN-GB": "EN-GB",
    EN: "EN"
  };

  return map[normalizedLocale] || normalizedLocale.split("-")[0];
};

const requireDeepLKey = () => {
  if (!process.env.DEEPL_API_KEY) {
    throw new Error("DEEPL_API_KEY is required");
  }

  return process.env.DEEPL_API_KEY;
};

const getDeepLEndpoint = () =>
  requireDeepLKey().endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";

const cleanupOldTmpFiles = async () => {
  const now = Date.now();

  try {
    await fs.mkdir(tmpRoot, { recursive: true });
    const userDirs = await fs.readdir(tmpRoot, { withFileTypes: true });

    for (const userDir of userDirs) {
      if (!userDir.isDirectory()) {
        continue;
      }

      const userTmpDir = path.join(tmpRoot, userDir.name);
      const jobDirs = await fs.readdir(userTmpDir, { withFileTypes: true });

      for (const jobDir of jobDirs) {
        if (!jobDir.isDirectory()) {
          continue;
        }

        const jobPath = path.join(userTmpDir, jobDir.name);
        const stats = await fs.stat(jobPath);

        if (now - stats.mtimeMs > tmpMaxAgeMs) {
          await fs.rm(jobPath, { recursive: true, force: true });
        }
      }
    }
  } catch (error) {
    console.error("Failed to cleanup tmp files", error);
  }
};

const videoStorage = multer.diskStorage({
  async destination(request, _file, callback) {
    const jobId = randomUUID();
    const jobDir = path.join(tmpRoot, request.userId, jobId);

    try {
      await fs.mkdir(jobDir, { recursive: true });
      request.uploadJob = { id: jobId, dir: jobDir };
      callback(null, jobDir);
    } catch (error) {
      callback(error);
    }
  },
  filename(request, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    request.uploadJob.videoPath = path.join(
      request.uploadJob.dir,
      `video${extension}`
    );
    request.uploadJob.audioPath = path.join(request.uploadJob.dir, "audio.wav");
    callback(null, `video${extension}`);
  }
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: {
    fileSize: maxVideoSizeBytes
  },
  fileFilter(_request, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();

    if (!allowedVideoExtensions.has(extension)) {
      callback(new Error("Format video inconnu"));
      return;
    }

    callback(null, true);
  }
});

const probeVideo = (videoPath) =>
  new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(metadata);
    });
  });

const extractAudio = (videoPath, audioPath) =>
  new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(["-vn", "-acodec pcm_s16le"])
      .output(audioPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

const detectSilences = (audioPath) =>
  new Promise((resolve, reject) => {
    const silences = [];
    let currentStart = null;

    ffmpeg(audioPath)
      .audioFilters("silencedetect=noise=-30dB:d=0.5")
      .format("null")
      .output("-")
      .on("stderr", (line) => {
        const startMatch = line.match(/silence_start: ([\d.]+)/);
        const endMatch = line.match(/silence_end: ([\d.]+)/);

        if (startMatch) {
          currentStart = Number(startMatch[1]);
        }

        if (endMatch && currentStart !== null) {
          silences.push({
            start: currentStart,
            end: Number(endMatch[1])
          });
          currentStart = null;
        }
      })
      .on("end", () => resolve(silences))
      .on("error", reject)
      .run();
  });

const cutAudioSegment = (audioPath, outputPath, offset, duration) =>
  new Promise((resolve, reject) => {
    ffmpeg(audioPath)
      .setStartTime(offset)
      .duration(duration)
      .outputOptions(["-acodec pcm_s16le"])
      .output(outputPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

const getVideoMetadata = (metadata) => {
  const videoStream = metadata.streams.find(
    (stream) => stream.codec_type === "video"
  );
  const audioStream = metadata.streams.find(
    (stream) => stream.codec_type === "audio"
  );

  if (!audioStream) {
    throw new Error("Pas de piste audio detectee");
  }

  return {
    duration: Number(metadata.format.duration ?? videoStream?.duration ?? 0),
    resolution:
      videoStream?.width && videoStream?.height
        ? `${videoStream.width}x${videoStream.height}`
        : null,
    codec: videoStream?.codec_name ?? null
  };
};

const getAudioSizeMb = async (audioPath) => {
  const stats = await fs.stat(audioPath);
  return Number((stats.size / 1024 / 1024).toFixed(2));
};

const getAudioDuration = async (audioPath) => {
  const metadata = await probeVideo(audioPath);
  return Number(metadata.format.duration ?? 0);
};

const createTranscriptChunks = async (audioPath, jobDir, audioSizeMb) => {
  if (audioSizeMb <= 25) {
    return [{ path: audioPath, offsetSeconds: 0 }];
  }

  const duration = await getAudioDuration(audioPath);
  const silences = await detectSilences(audioPath);
  const maxDuration = Math.max(
    1,
    Math.floor((duration * maxTranscriptChunkMb) / audioSizeMb)
  );
  const chunksDir = path.join(jobDir, "chunks");
  const chunks = [];
  let start = 0;
  let index = 0;

  await fs.mkdir(chunksDir, { recursive: true });

  while (start < duration) {
    const targetEnd = Math.min(start + maxDuration, duration);
    const silence = silences
      .filter((item) => item.end > start + 1 && item.end <= targetEnd)
      .sort((a, b) => b.end - a.end)[0];
    const end = silence?.end ?? targetEnd;
    const chunkPath = path.join(chunksDir, `audio-${index}.wav`);

    await cutAudioSegment(audioPath, chunkPath, start, end - start);
    chunks.push({ path: chunkPath, offsetSeconds: start });

    start = end;
    index += 1;
  }

  return chunks;
};

const applyOffset = (items = [], offsetSeconds) =>
  items.map((item) => ({
    ...item,
    start: Number((Number(item.start ?? 0) + offsetSeconds).toFixed(3)),
    end: Number((Number(item.end ?? 0) + offsetSeconds).toFixed(3))
  }));

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const transcribeAudio = async ({ audioPath, offsetSeconds, language }) => {
  const transcription = await getOpenAIClient().audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
    ...(language ? { language } : {})
  });
  const offsetWords = applyOffset(transcription.words, offsetSeconds);

  return applyOffset(transcription.segments, offsetSeconds).map((segment) => ({
    id: `${offsetSeconds}-${segment.id}`,
    start: segment.start,
    end: segment.end,
    text: segment.text?.trim() ?? "",
    words: offsetWords.filter(
      (word) => word.start >= segment.start && word.end <= segment.end
    )
  }));
};

const requireGoogleTtsKey = () => {
  if (!process.env.GOOGLE_TTS_API_KEY) {
    throw new Error("GOOGLE_TTS_API_KEY is required");
  }

  return process.env.GOOGLE_TTS_API_KEY;
};

const requireGeminiApiKey = () => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_TTS_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required");
  }

  return apiKey;
};

const logExternalApiError = (label, error) => {
  console.error(label, {
    message: error.message,
    status: error.response?.status,
    statusText: error.response?.statusText,
    providerError: error.response?.data?.error?.message
  });
};

const ttsProviderErrorMessage =
  "Google Text-to-Speech refuse la clé API. Active Cloud Text-to-Speech API et vérifie les restrictions de clé.";

const geminiTtsErrorMessage =
  "Gemini API refuse la clé. Ajoute GEMINI_API_KEY dans server/.env depuis Google AI Studio, ou utilise une clé Google non limitée compatible Gemini.";

// Static voice list — Gemini TTS doesn't expose a discovery endpoint
const geminiVoices = [
  { name: "Aoede", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Kore", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Leda", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Zephyr", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Callirrhoe", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Autonoe", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Despina", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Iocaste", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Laomedeia", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Achernar", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Schedar", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Pulcherrima", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Sulafat", gender: "FEMALE", type: "Gemini TTS" },
  { name: "Charon", gender: "MALE", type: "Gemini TTS" },
  { name: "Fenrir", gender: "MALE", type: "Gemini TTS" },
  { name: "Puck", gender: "MALE", type: "Gemini TTS" },
  { name: "Orus", gender: "MALE", type: "Gemini TTS" },
  { name: "Umbriel", gender: "MALE", type: "Gemini TTS" },
  { name: "Algieba", gender: "MALE", type: "Gemini TTS" },
  { name: "Alnilam", gender: "MALE", type: "Gemini TTS" },
  { name: "Gacrux", gender: "MALE", type: "Gemini TTS" },
  { name: "Rasalgethi", gender: "MALE", type: "Gemini TTS" },
  { name: "Sadaltager", gender: "MALE", type: "Gemini TTS" },
  { name: "Zubenelgenubi", gender: "MALE", type: "Gemini TTS" }
];

const chirp3VoiceNames = {
  "fr-FR": [
    "fr-FR-Chirp3-HD-Achernar",
    "fr-FR-Chirp3-HD-Aoede",
    "fr-FR-Chirp3-HD-Charon",
    "fr-FR-Chirp3-HD-Kore",
    "fr-FR-Chirp3-HD-Puck",
    "fr-FR-Chirp3-HD-Zephyr"
  ],
  "en-US": [
    "en-US-Chirp3-HD-Aoede",
    "en-US-Chirp3-HD-Charon",
    "en-US-Chirp3-HD-Kore",
    "en-US-Chirp3-HD-Puck",
    "en-US-Chirp3-HD-Zephyr"
  ],
  "en-GB": [
    "en-GB-Chirp3-HD-Aoede",
    "en-GB-Chirp3-HD-Charon",
    "en-GB-Chirp3-HD-Kore",
    "en-GB-Chirp3-HD-Puck",
    "en-GB-Chirp3-HD-Zephyr"
  ],
  "de-DE": [
    "de-DE-Chirp3-HD-Aoede",
    "de-DE-Chirp3-HD-Charon",
    "de-DE-Chirp3-HD-Kore",
    "de-DE-Chirp3-HD-Puck",
    "de-DE-Chirp3-HD-Zephyr"
  ],
  "es-ES": [
    "es-ES-Chirp3-HD-Aoede",
    "es-ES-Chirp3-HD-Charon",
    "es-ES-Chirp3-HD-Kore",
    "es-ES-Chirp3-HD-Puck",
    "es-ES-Chirp3-HD-Zephyr"
  ],
  "it-IT": [
    "it-IT-Chirp3-HD-Aoede",
    "it-IT-Chirp3-HD-Charon",
    "it-IT-Chirp3-HD-Kore",
    "it-IT-Chirp3-HD-Puck",
    "it-IT-Chirp3-HD-Zephyr"
  ]
};

const fallbackChirp3Voices = (languageCode) =>
  (chirp3VoiceNames[languageCode] ?? []).map((name) => ({
    name,
    gender: ["Aoede", "Kore", "Zephyr"].some((voice) => name.includes(voice))
      ? "FEMALE"
      : "MALE",
    type: "Chirp3 HD"
  }));

const getVoiceType = (voiceName) => {
  const knownTypes = ["Chirp3", "Chirp", "Studio", "Neural2", "Wavenet", "Standard"];
  return knownTypes.find((type) => voiceName.includes(type)) ?? "Standard";
};

const languageCodeFromVoiceName = (voiceName, fallbackLanguageCode) => {
  const match = String(voiceName).match(/^([a-z]{2}-[A-Z]{2})-/);
  return match?.[1] ?? fallbackLanguageCode;
};

// Gemini TTS returns raw PCM (s16le, 24 kHz, mono) — convert to MP3 for the timeline
const convertPcmToMp3 = async (base64Pcm, outputPath) => {
  const pcmPath = outputPath.replace(/\.mp3$/, ".pcm");
  await fs.writeFile(pcmPath, Buffer.from(base64Pcm, "base64"));

  await new Promise((resolve, reject) => {
    ffmpeg(pcmPath)
      .inputFormat("s16le")
      .inputOptions(["-ar 24000", "-ac 1"])
      .output(outputPath)
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

  await fs.unlink(pcmPath).catch(() => {});
};

const synthesizeSpeechGemini = async ({ text, voiceName }) => {
  const response = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
    {
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName }
          }
        }
      }
    },
    { params: { key: requireGeminiApiKey() } }
  );

  const inlineData =
    response.data.candidates?.[0]?.content?.parts?.[0]?.inlineData;

  if (!inlineData?.data) {
    throw new Error("No audio data in Gemini TTS response");
  }

  return inlineData.data; // base64-encoded raw PCM
};

const synthesizeSpeech = async ({
  text,
  languageCode,
  voiceName,
  speakingRate = 1
}) => {
  const effectiveLanguageCode = languageCodeFromVoiceName(
    voiceName,
    languageCode
  );

  const response = await axios.post(
    "https://texttospeech.googleapis.com/v1/text:synthesize",
    {
      input: { text },
      voice: {
        languageCode: effectiveLanguageCode,
        name: voiceName
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate
      }
    },
    {
      params: {
        key: requireGoogleTtsKey()
      }
    }
  );

  return response.data.audioContent;
};

const safeSegmentId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "_");

const createTtsSegment = async ({
  jobDir,
  segment,
  voiceName,
  languageCode,
  provider = "google"
}) => {
  const ttsDir = path.join(jobDir, "tts");
  const segmentId = safeSegmentId(segment.id);
  const audioFile = path.join(ttsDir, `segment_${segmentId}.mp3`);
  const sourceDuration = Number(segment.end) - Number(segment.start);
  const speakingRate = Number(segment.speakingRate ?? 1);

  await fs.mkdir(ttsDir, { recursive: true });

  if (provider === "gemini") {
    const pcmData = await synthesizeSpeechGemini({
      text: segment.translatedText || segment.text,
      voiceName
    });
    await convertPcmToMp3(pcmData, audioFile);
  } else {
    const audioContent = await synthesizeSpeech({
      text: segment.translatedText || segment.text,
      languageCode,
      voiceName,
      speakingRate
    });
    await fs.writeFile(audioFile, Buffer.from(audioContent, "base64"));
  }

  const duration = await getAudioDuration(audioFile);
  const ratio = sourceDuration > 0 ? duration / sourceDuration : 1;
  const needsSpeedAdjust = duration > sourceDuration * 1.15;

  return {
    id: segment.id,
    start: segment.start,
    end: segment.end,
    audioFile,
    duration,
    needsSpeedAdjust,
    ratio: Number(ratio.toFixed(2))
  };
};

const getExportKey = (userId, jobId) => `${userId}:${jobId}`;

const getJobDir = (userId, jobId) => path.join(tmpRoot, userId, jobId);

const findJobVideoPath = async (jobDir) => {
  const files = await fs.readdir(jobDir);
  const videoFile = files.find((file) => /^video\.(mp4|mov|mkv|webm)$/i.test(file));

  if (!videoFile) {
    throw new Error("Original video not found");
  }

  return path.join(jobDir, videoFile);
};

const buildExportFilter = ({ segments, volumeOV, volumeDUB }) => {
  const filters = [`[0:a]volume=${volumeOV}[ov]`];

  segments.forEach((segment, index) => {
    const inputIndex = index + 1;
    const delayMs = Math.max(0, Math.round(Number(segment.start) * 1000));
    filters.push(
      `[${inputIndex}:a]volume=${volumeDUB},adelay=${delayMs}|${delayMs}[dub${index}]`
    );
  });

  if (segments.length === 1) {
    filters.push("[dub0]anull[dub]");
  } else {
    filters.push(
      `${segments.map((_segment, index) => `[dub${index}]`).join("")}amix=inputs=${segments.length}:duration=longest[dub]`
    );
  }

  filters.push("[ov][dub]amix=inputs=2:duration=first[mix]");
  return filters.join(";");
};

const runExportJob = async ({ userId, jobId, segments, volumeOV, volumeDUB }) => {
  const exportKey = getExportKey(userId, jobId);
  const jobDir = getJobDir(userId, jobId);
  const outputPath = path.join(jobDir, "output.mp4");

  try {
    const videoPath = await findJobVideoPath(jobDir);
    const normalizedSegments = segments.map((segment) => ({
      ...segment,
      audioFile: path.join(jobDir, "tts", path.basename(segment.audioFile))
    }));
    const filterComplex = buildExportFilter({
      segments: normalizedSegments,
      volumeOV,
      volumeDUB
    });

    await new Promise((resolve, reject) => {
      const command = ffmpeg(videoPath);

      normalizedSegments.forEach((segment) => command.input(segment.audioFile));
      command
        .complexFilter(filterComplex)
        .outputOptions([
          "-map 0:v",
          "-map [mix]",
          "-c:v copy",
          "-c:a aac",
          "-b:a 192k",
          "-movflags +faststart"
        ])
        .output(outputPath)
        .on("progress", (progress) => {
          const currentJob = exportJobs.get(exportKey);
          if (currentJob) {
            currentJob.progress = Math.min(95, Math.round(progress.percent ?? 0));
          }
        })
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    exportJobs.set(exportKey, {
      outputPath,
      progress: 100,
      status: "completed"
    });
  } catch (error) {
    console.error("Failed to export dubbed video", error);
    exportJobs.set(exportKey, {
      error: "Unable to export video",
      progress: 100,
      status: "failed"
    });
  }
};

app.get("/api/admin/users", adminAuth, async (_request, response) => {
  try {
    const users = await clerkClient.users.getUserList();
    response.json({
      users: users.data.map(serializeUser)
    });
  } catch (error) {
    console.error("Failed to list Clerk users", error);
    response.status(500).json({ error: "Unable to list users" });
  }
});

app.post("/api/admin/invitations", adminAuth, async (request, response) => {
  const { emailAddress, redirectUrl } = request.body;
  const email = String(emailAddress || "").trim().toLowerCase();
  const safeRedirectUrl =
    typeof redirectUrl === "string" &&
    redirectUrl.startsWith("https://") &&
    !redirectUrl.includes("localhost") &&
    !redirectUrl.includes("127.0.0.1")
      ? redirectUrl
      : "";
  const safeAppPublicUrl =
    appPublicUrl.startsWith("https://") &&
    !appPublicUrl.includes("localhost") &&
    !appPublicUrl.includes("127.0.0.1")
      ? appPublicUrl
      : "";

  if (!email || !email.includes("@")) {
    response.status(400).json({ error: "A valid emailAddress is required" });
    return;
  }

  try {
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      expiresInDays: 30,
      ignoreExisting: true,
      notify: true,
      publicMetadata: {
        approved: false,
        role: "user"
      },
      ...(safeRedirectUrl || safeAppPublicUrl
        ? { redirectUrl: safeRedirectUrl || safeAppPublicUrl }
        : {})
    });

    response.json({
      invitation: {
        createdAt: invitation.createdAt,
        emailAddress: invitation.emailAddress,
        id: invitation.id,
        status: invitation.status,
        url: invitation.url
      }
    });
  } catch (error) {
    console.error("Failed to create Clerk invitation", error);
    response.status(500).json({ error: "Unable to invite user" });
  }
});

app.patch("/api/admin/users/:id/approve", adminAuth, async (request, response) => {
  try {
    const user = await clerkClient.users.getUser(request.params.id);
    const updatedUser = await clerkClient.users.updateUserMetadata(
      request.params.id,
      {
        publicMetadata: {
          ...user.publicMetadata,
          approved: true
        }
      }
    );

    let approvalEmail = { skipped: true };

    try {
      approvalEmail = await sendApprovalEmail(updatedUser);
    } catch (emailError) {
      console.error("Failed to send approval email", emailError);
      approvalEmail = {
        error:
          emailError.response?.data?.message ||
          emailError.response?.data?.error ||
          "Unable to send approval email",
        skipped: false
      };
    }

    response.json({ approvalEmail, user: serializeUser(updatedUser) });
  } catch (error) {
    console.error("Failed to approve Clerk user", error);
    response.status(500).json({ error: "Unable to approve user" });
  }
});

app.patch("/api/admin/users/:id/block", adminAuth, async (request, response) => {
  try {
    const user = await clerkClient.users.banUser(request.params.id);
    response.json({ user: serializeUser(user) });
  } catch (error) {
    console.error("Failed to block Clerk user", error);
    response.status(500).json({ error: "Unable to block user" });
  }
});

app.delete("/api/admin/users/:id", adminAuth, async (request, response) => {
  try {
    await clerkClient.users.deleteUser(request.params.id);
    response.json({ success: true });
  } catch (error) {
    console.error("Failed to delete Clerk user", error);
    response.status(500).json({ error: "Unable to delete user" });
  }
});

app.post("/api/upload", (request, response) => {
  uploadVideo.single("video")(request, response, async (error) => {
    if (error) {
      response.status(400).json({ error: error.message });
      return;
    }

    if (!request.file) {
      response.status(400).json({ error: "Aucune video fournie" });
      return;
    }

    try {
      const { id: jobId, videoPath, audioPath } = request.uploadJob;
      const metadata = await probeVideo(videoPath);
      const videoMetadata = getVideoMetadata(metadata);

      await extractAudio(videoPath, audioPath);

      const audioSizeMb = await getAudioSizeMb(audioPath);

      response.status(201).json({
        jobId,
        ...videoMetadata,
        audioPath,
        audioSizeMb
      });
    } catch (processingError) {
      console.error("Failed to process uploaded video", processingError);
      response.status(400).json({
        error:
          processingError.message === "Pas de piste audio detectee"
            ? "Pas de piste audio"
            : "Format inconnu ou video impossible a traiter"
      });
    }
  });
});

app.post("/api/transcribe", async (request, response) => {
  const { jobId, language } = request.body;

  if (!jobId) {
    response.status(400).json({ error: "jobId is required" });
    return;
  }

  try {
    const jobDir = path.join(tmpRoot, request.userId, jobId);
    const audioPath = path.join(jobDir, "audio.wav");
    const audioSizeMb = await getAudioSizeMb(audioPath);
    const chunks = await createTranscriptChunks(audioPath, jobDir, audioSizeMb);
    const transcript = [];

    for (const chunk of chunks) {
      const segments = await transcribeAudio({
        audioPath: chunk.path,
        offsetSeconds: chunk.offsetSeconds,
        language
      });
      transcript.push(...segments);
    }

    transcript.sort((a, b) => a.start - b.start);
    response.json({ transcript });
  } catch (error) {
    console.error("Failed to transcribe audio", error);
    response.status(500).json({ error: "Unable to transcribe audio" });
  }
});

app.post("/api/translate", async (request, response) => {
  const { segments, sourceLang, targetLang = "fr-FR" } = request.body;

  if (!Array.isArray(segments) || segments.length === 0) {
    response.status(400).json({ error: "segments are required" });
    return;
  }

  try {
    const params = new URLSearchParams();
    params.set("target_lang", deeplTargetFromLocale(targetLang));

    if (sourceLang) {
      params.set("source_lang", deeplTargetFromLocale(sourceLang));
    }

    segments.forEach((segment) => {
      params.append("text", segment.text || "");
    });

    const deeplResponse = await axios.post(getDeepLEndpoint(), params, {
      headers: {
        Authorization: `DeepL-Auth-Key ${requireDeepLKey()}`,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const translations = deeplResponse.data.translations || [];
    response.json({
      segments: segments.map((segment, index) => ({
        ...segment,
        translatedText: translations[index]?.text || segment.translatedText || ""
      }))
    });
  } catch (error) {
    logExternalApiError("Failed to translate with DeepL", error);
    response.status(error.message === "DEEPL_API_KEY is required" ? 400 : 500).json({
      error:
        error.message === "DEEPL_API_KEY is required"
          ? "Ajoute DEEPL_API_KEY dans server/.env pour activer la traduction."
          : "Traduction DeepL impossible."
    });
  }
});

app.get("/api/jobs/:jobId/audio", async (request, response) => {
  const audioPath = path.join(
    tmpRoot,
    request.userId,
    request.params.jobId,
    "audio.wav"
  );

  response.sendFile(audioPath, (error) => {
    if (error) {
      response.status(404).json({ error: "Audio not found" });
    }
  });
});

app.get("/api/jobs/:jobId/video", async (request, response) => {
  try {
    const jobDir = path.join(tmpRoot, request.userId, request.params.jobId);
    const videoPath = await findJobVideoPath(jobDir);

    response.sendFile(videoPath, (error) => {
      if (error) {
        response.status(404).json({ error: "Video not found" });
      }
    });
  } catch {
    response.status(404).json({ error: "Video not found" });
  }
});

app.get("/api/jobs/:jobId/tts/:filename", async (request, response) => {
  const filename = path.basename(request.params.filename);

  if (!filename.startsWith("segment_") || !filename.endsWith(".mp3")) {
    response.status(400).json({ error: "Invalid audio file" });
    return;
  }

  const audioPath = path.join(
    tmpRoot,
    request.userId,
    request.params.jobId,
    "tts",
    filename
  );

  response.sendFile(audioPath, (error) => {
    if (error) {
      response.status(404).json({ error: "Audio not found" });
    }
  });
});

app.get("/api/tts/voices", async (request, response) => {
  const languageCode = request.query.language || "fr-FR";
  const provider = request.query.provider || "google";

  // Gemini voices are static (no discovery endpoint)
  if (provider === "gemini") {
    response.json({ voices: geminiVoices });
    return;
  }

  try {
    const voicesResponse = await axios.get(
      "https://texttospeech.googleapis.com/v1/voices",
      {
        params: {
          languageCode,
          key: requireGoogleTtsKey()
        }
      }
    );

    const voices = voicesResponse.data.voices
      .map((voice) => ({
        name: voice.name,
        gender: voice.ssmlGender,
        type: getVoiceType(voice.name)
      }))
      .filter((voice) =>
        provider === "chirp3" ? voice.name.includes("-Chirp3-HD-") : true
      );

    response.json({
      voices: voices.length > 0 ? voices : fallbackChirp3Voices(languageCode)
    });
  } catch (error) {
    logExternalApiError("Failed to list Google TTS voices", error);
    if (provider === "chirp3") {
      response.json({
        warning: ttsProviderErrorMessage,
        voices: fallbackChirp3Voices(languageCode)
      });
      return;
    }

    response.status(error.response?.status === 403 ? 403 : 500).json({
      error:
        error.response?.status === 403
          ? ttsProviderErrorMessage
          : "Unable to list TTS voices"
    });
  }
});

app.post("/api/tts/preview", async (request, response) => {
  const {
    voiceName,
    languageCode,
    provider = "google",
    text = "Apercu de la voix DubSync."
  } = request.body;

  if (!voiceName || !languageCode) {
    response.status(400).json({ error: "voiceName and languageCode are required" });
    return;
  }

  try {
    if (provider === "gemini") {
      const tmpMp3 = path.join(tmpRoot, `preview_${randomUUID()}.mp3`);
      await fs.mkdir(tmpRoot, { recursive: true });
      const pcmData = await synthesizeSpeechGemini({ text, voiceName });
      await convertPcmToMp3(pcmData, tmpMp3);
      const mp3Buffer = await fs.readFile(tmpMp3);
      await fs.unlink(tmpMp3).catch(() => {});
      response.json({
        audioContent: mp3Buffer.toString("base64"),
        mimeType: "audio/mpeg"
      });
      return;
    }

    const audioContent = await synthesizeSpeech({ text, languageCode, voiceName });
    response.json({ audioContent, mimeType: "audio/mpeg" });
  } catch (error) {
    logExternalApiError("Failed to generate TTS preview", error);
    const isGemini = provider === "gemini";
    const is403 = error.response?.status === 403;
    response.status(is403 ? 403 : 500).json({
      error: is403
        ? (isGemini ? geminiTtsErrorMessage : ttsProviderErrorMessage)
        : "Unable to generate TTS preview"
    });
  }
});

app.post("/api/tts/generate", async (request, response) => {
  const { jobId, segments, voiceName, languageCode, provider = "google" } = request.body;

  if (!jobId || !Array.isArray(segments) || !voiceName || !languageCode) {
    response.status(400).json({
      error: "jobId, segments, voiceName and languageCode are required"
    });
    return;
  }

  try {
    const jobDir = path.join(tmpRoot, request.userId, jobId);
    const ttsSegments = [];

    for (const segment of segments) {
      const ttsSegment = await createTtsSegment({
        jobDir,
        segment,
        voiceName,
        languageCode,
        provider
      });
      ttsSegments.push(ttsSegment);
    }

    response.json({ ttsSegments });
  } catch (error) {
    logExternalApiError("Failed to generate TTS", error);
    const isGemini = provider === "gemini";
    const is403 = error.response?.status === 403;
    response.status(is403 ? 403 : 500).json({
      error: is403
        ? (isGemini ? geminiTtsErrorMessage : ttsProviderErrorMessage)
        : "Unable to generate TTS"
    });
  }
});

app.post("/api/export", async (request, response) => {
  const { jobId, segments, volumeOV = 0.3, volumeDUB = 1 } = request.body;

  if (!jobId || !Array.isArray(segments) || segments.length === 0) {
    response.status(400).json({ error: "jobId and segments are required" });
    return;
  }

  const exportKey = getExportKey(request.userId, jobId);
  exportJobs.set(exportKey, {
    progress: 0,
    status: "processing"
  });

  runExportJob({
    userId: request.userId,
    jobId,
    segments,
    volumeOV: Number(volumeOV),
    volumeDUB: Number(volumeDUB)
  });

  response.status(202).json({ jobId, status: "processing" });
});

app.get("/api/export/status/:jobId", (request, response) => {
  const exportJob = exportJobs.get(getExportKey(request.userId, request.params.jobId));

  if (!exportJob) {
    response.json({ progress: 0, status: "idle" });
    return;
  }

  response.json({
    error: exportJob.error,
    progress: exportJob.progress,
    status: exportJob.status
  });
});

app.get("/api/export/download/:jobId", (request, response) => {
  const exportJob = exportJobs.get(getExportKey(request.userId, request.params.jobId));

  if (!exportJob || exportJob.status !== "completed") {
    response.status(404).json({ error: "Export not ready" });
    return;
  }

  response.download(exportJob.outputPath, "dubsync-output.mp4", async (error) => {
    if (!error) {
      await fs.rm(getJobDir(request.userId, request.params.jobId), {
        force: true,
        recursive: true
      });
      exportJobs.delete(getExportKey(request.userId, request.params.jobId));
    }
  });
});

app.delete("/api/export/cleanup/:jobId", async (request, response) => {
  const exportKey = getExportKey(request.userId, request.params.jobId);
  const exportJob = exportJobs.get(exportKey);

  try {
    if (exportJob?.outputPath) {
      await fs.rm(exportJob.outputPath, { force: true });
    }
    await fs.rm(getJobDir(request.userId, request.params.jobId), {
      force: true,
      recursive: true
    });
    exportJobs.delete(exportKey);
    response.json({ success: true });
  } catch (error) {
    console.error("Failed to cleanup export", error);
    response.status(500).json({ error: "Unable to cleanup export" });
  }
});

cron.schedule("0 * * * *", cleanupOldTmpFiles);

app.post("/api/uploads", upload.single("file"), (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: "No file uploaded" });
    return;
  }

  response.status(201).json({
    filename: request.file.originalname,
    mimetype: request.file.mimetype,
    size: request.file.size
  });
});

const server = app.listen(port, () => {
  console.log(`DubSync server listening on http://localhost:${port}`);
});

server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 31 * 60 * 1000;
