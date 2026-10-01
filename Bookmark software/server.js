const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_MODEL,
  DEFAULT_SCORE_THRESHOLD,
  PROMPT_VERSION,
  analyzeMemoryWithGemini
} = require("./gemini-memory");

const root = __dirname;
const dataDir = path.join(root, "data");
const patientsFile = path.join(dataDir, "patients.json");
const mediaDir = path.join(root, "media", "memories");
const envFile = path.join(root, ".env");
const port = Number(process.env.PORT || 5173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".wav": "audio/wav",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(mediaDir, { recursive: true });
if (!fs.existsSync(patientsFile)) fs.writeFileSync(patientsFile, "{}\n");

function localIps() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

function readPatients() {
  try { return JSON.parse(fs.readFileSync(patientsFile, "utf8")); }
  catch { return {}; }
}

function writePatients(patients) {
  const temporary = `${patientsFile}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(patients, null, 2) + "\n");
  fs.renameSync(temporary, patientsFile);
}

function readLocalEnv() {
  try {
    return fs.readFileSync(envFile, "utf8").split(/\r?\n/).reduce((values, line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || line.trimStart().startsWith("#")) return values;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[match[1]] = value;
      return values;
    }, {});
  } catch {
    return {};
  }
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function geminiConfig() {
  const local = readLocalEnv();
  const value = (name, fallback = "") => process.env[name] || local[name] || fallback;
  return {
    apiKey: String(value("GEMINI_API_KEY")).trim(),
    model: String(value("GEMINI_MODEL", DEFAULT_MODEL)).trim(),
    scoreThreshold: boundedNumber(value("MEMORY_SCORE_THRESHOLD"), DEFAULT_SCORE_THRESHOLD, 0, 100),
    confidenceThreshold: boundedNumber(value("MEMORY_CONFIDENCE_THRESHOLD"), DEFAULT_CONFIDENCE_THRESHOLD, 0, 100)
  };
}

function hasGeminiKey(apiKey) {
  return Boolean(apiKey) && !/^여기에_|^your_|^put_/i.test(apiKey);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readJson(req, callback, maxBytes = 2_000_000) {
  let body = "";
  let size = 0;
  let settled = false;
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    if (settled) return;
    size += Buffer.byteLength(chunk);
    if (size > maxBytes) {
      settled = true;
      const error = new Error("request_too_large");
      error.code = "request_too_large";
      callback(error);
      return;
    }
    body += chunk;
  });
  req.on("end", () => {
    if (settled) return;
    settled = true;
    try { callback(null, JSON.parse(body || "{}")); }
    catch (error) { callback(error); }
  });
  req.on("error", (error) => {
    if (settled) return;
    settled = true;
    callback(error);
  });
}

function decodeBase64(data, maxBytes, label) {
  const encoded = String(data || "");
  if (!encoded || encoded.length > Math.ceil(maxBytes * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    const error = new Error(`${label}_invalid`);
    error.code = `${label}_invalid`;
    throw error;
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > maxBytes) {
    const error = new Error(`${label}_invalid`);
    error.code = `${label}_invalid`;
    throw error;
  }
  return buffer;
}

function validateJpegFrames(rawFrames, maximumCount, maximumTotalBytes) {
  if (!Array.isArray(rawFrames) || rawFrames.length === 0 || rawFrames.length > maximumCount) {
    const error = new Error("video_frames_invalid");
    error.code = "video_frames_invalid";
    throw error;
  }

  let totalFrameBytes = 0;
  const frames = rawFrames.map((frame) => {
    if (frame?.mimeType !== "image/jpeg") {
      const error = new Error("video_frame_type_invalid");
      error.code = "video_frame_type_invalid";
      throw error;
    }
    const buffer = decodeBase64(frame.data, 850_000, "video_frame");
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9) {
      const error = new Error("video_frame_invalid");
      error.code = "video_frame_invalid";
      throw error;
    }
    totalFrameBytes += buffer.length;
    return { mimeType: "image/jpeg", data: frame.data, buffer };
  });
  if (totalFrameBytes > maximumTotalBytes) {
    const error = new Error("video_frames_too_large");
    error.code = "video_frames_too_large";
    throw error;
  }
  return frames;
}

function validateCapture(payload) {
  const frames = validateJpegFrames(payload.frames, 8, 5_500_000);
  const videoFrames = payload.videoFrames
    ? validateJpegFrames(payload.videoFrames, 96, 12_000_000)
    : frames;

  let audio = null;
  if (payload.audio?.data) {
    if (payload.audio.mimeType !== "audio/wav") {
      const error = new Error("audio_type_invalid");
      error.code = "audio_type_invalid";
      throw error;
    }
    const buffer = decodeBase64(payload.audio.data, 2_500_000, "audio");
    if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
      const error = new Error("audio_invalid");
      error.code = "audio_invalid";
      throw error;
    }
    audio = { mimeType: "audio/wav", data: payload.audio.data, buffer };
  }
  return {
    frames,
    videoFrames,
    audio,
    durationMs: boundedNumber(payload.durationMs, videoFrames.length * 480, 1000, 30_000)
  };
}

function formatMemoryDate(value) {
  const date = new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(safeDate);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${pick("year")}.${pick("month")}.${pick("day")}`;
}

function memoryType(eventType) {
  if (["family_interaction", "celebration"].includes(eventType)) return "party";
  if (["meaningful_conversation", "familiar_activity"].includes(eventType)) return "stage";
  return "calm";
}

function moodLabel(mood) {
  return {
    joyful: "즐거운 반응",
    calm: "평온한 반응",
    connected: "정서적 교감",
    neutral: "편안한 일상",
    distressed: "주의 필요",
    unclear: "반응 확인 필요"
  }[mood] || "반응 확인 필요";
}

function saveMemoryMedia(memoryId, frames, audio) {
  const directory = path.join(mediaDir, memoryId);
  fs.mkdirSync(directory, { recursive: true });
  const frameUrls = frames.map((frame, index) => {
    const filename = `frame-${String(index + 1).padStart(2, "0")}.jpg`;
    fs.writeFileSync(path.join(directory, filename), frame.buffer);
    return `/media/memories/${memoryId}/${filename}`;
  });
  let audioUrl = null;
  if (audio) {
    fs.writeFileSync(path.join(directory, "audio.wav"), audio.buffer);
    audioUrl = `/media/memories/${memoryId}/audio.wav`;
  }
  return { frameUrls, audioUrl };
}

function removeMemoryMedia(memory) {
  const memoryId = String(memory?.id || "");
  if (!/^[A-Za-z0-9_-]+$/.test(memoryId)) return;
  const directory = path.join(mediaDir, memoryId);
  if (directory.startsWith(mediaDir + path.sep)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function analysisErrorResponse(error) {
  const knownClientErrors = new Set([
    "video_frames_invalid",
    "video_frame_type_invalid",
    "video_frame_invalid",
    "video_frames_too_large",
    "audio_type_invalid",
    "audio_invalid"
  ]);
  if (knownClientErrors.has(error.code)) {
    return { status: 400, payload: { error: error.code, message: "수신한 영상 또는 오디오 형식이 올바르지 않습니다." } };
  }
  return {
    status: Number.isInteger(error.status) ? error.status : 500,
    payload: {
      error: error.code || "analysis_failed",
      message: error.message || "영상 분석에 실패했습니다."
    }
  };
}

function handleMemoryAnalysis(req, res) {
  readJson(req, async (readError, payload) => {
    if (readError) {
      sendJson(res, readError.code === "request_too_large" ? 413 : 400, {
        error: readError.code || "invalid_json",
        message: "분석 요청을 읽을 수 없습니다."
      });
      return;
    }

    try {
      const patientEmail = String(payload.patientEmail || "").trim().toLowerCase();
      const captureId = String(payload.captureId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
      if (!patientEmail || !captureId) {
        sendJson(res, 400, { error: "capture_identity_missing", message: "환자 또는 촬영 정보가 없습니다." });
        return;
      }

      const patients = readPatients();
      const patient = patients[patientEmail];
      if (!patient) {
        sendJson(res, 404, { error: "patient_not_found", message: "연결된 환자 프로필을 찾지 못했습니다." });
        return;
      }

      const existing = (patient.memories || []).find((memory) => memory.captureId === captureId);
      if (existing) {
        sendJson(res, 200, {
          saved: true,
          duplicate: true,
          analysis: existing.aiAnalysis,
          memory: existing,
          patient
        });
        return;
      }

      if (patient.lastAnalysis?.captureId === captureId) {
        sendJson(res, 200, {
          saved: false,
          duplicate: true,
          analysis: patient.lastAnalysis,
          patient
        });
        return;
      }

      const capture = validateCapture(payload);
      const config = geminiConfig();
      const result = await analyzeMemoryWithGemini({
        ...config,
        frames: capture.frames,
        audio: capture.audio,
        patientName: patient.name,
        capturedAt: payload.capturedAt
      });

      const latestAnalysis = {
        ...result.analysis,
        captureId,
        saved: result.analysis.shouldSave,
        model: result.model,
        promptVersion: result.promptVersion,
        analyzedAt: new Date().toISOString()
      };
      patient.lastAnalysis = latestAnalysis;

      if (!result.analysis.shouldSave) {
        patients[patientEmail] = patient;
        writePatients(patients);
        sendJson(res, 200, {
          saved: false,
          analysis: result.analysis,
          patient,
          model: result.model,
          promptVersion: result.promptVersion
        });
        return;
      }

      const memoryId = `ai-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
      const media = saveMemoryMedia(memoryId, capture.videoFrames, capture.audio);
      const representative = Math.round(
        result.analysis.representativeFrameIndex
        * Math.max(0, media.frameUrls.length - 1)
        / Math.max(1, capture.frames.length - 1)
      );
      const memory = {
        id: memoryId,
        captureId,
        title: result.analysis.title,
        date: formatMemoryDate(payload.capturedAt),
        place: result.analysis.place,
        mood: `${moodLabel(result.analysis.mood)} · AI ${result.analysis.memoryScore}점`,
        type: memoryType(result.analysis.eventType),
        favorite: false,
        image: media.frameUrls[representative],
        frames: media.frameUrls,
        frameIntervalMs: Math.round(capture.durationMs / Math.max(1, media.frameUrls.length)),
        durationMs: capture.durationMs,
        audio: media.audioUrl,
        script: result.analysis.summary,
        source: "gemini",
        aiAnalysis: {
          ...latestAnalysis
        }
      };

      patient.memories = [memory, ...(patient.memories || [])];
      patients[patientEmail] = patient;
      writePatients(patients);
      sendJson(res, 200, { saved: true, analysis: result.analysis, memory, patient });
    } catch (error) {
      const response = analysisErrorResponse(error);
      console.error(`[Gemini] ${error.code || "analysis_failed"}: ${error.details || error.message}`);
      sendJson(res, response.status, response.payload);
    }
  }, 20_000_000);
}

function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/gemini/status") {
    const config = geminiConfig();
    sendJson(res, 200, {
      configured: hasGeminiKey(config.apiKey),
      model: config.model,
      scoreThreshold: config.scoreThreshold,
      confidenceThreshold: config.confidenceThreshold,
      promptVersion: PROMPT_VERSION
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze-memory") {
    handleMemoryAnalysis(req, res);
    return true;
  }

  const memoryRoute = url.pathname.match(/^\/api\/patients\/([^/]+)\/memories\/([^/]+)$/);
  if (req.method === "DELETE" && memoryRoute) {
    const email = decodeURIComponent(memoryRoute[1]).trim().toLowerCase();
    const memoryId = decodeURIComponent(memoryRoute[2]).trim();
    const patients = readPatients();
    const patient = patients[email];
    if (!patient) {
      sendJson(res, 404, { error: "patient_not_found" });
      return true;
    }

    const memoryIndex = (patient.memories || []).findIndex((memory) => memory.id === memoryId);
    if (memoryIndex < 0) {
      sendJson(res, 404, { error: "memory_not_found" });
      return true;
    }

    const [removedMemory] = patient.memories.splice(memoryIndex, 1);
    removeMemoryMedia(removedMemory);
    patients[email] = patient;
    writePatients(patients);
    sendJson(res, 200, { deleted: true, memoryId, patient });
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/patients/")) {
    const email = decodeURIComponent(url.pathname.slice("/api/patients/".length)).trim().toLowerCase();
    const patient = readPatients()[email];
    if (!patient) sendJson(res, 404, { error: "patient_not_found" });
    else sendJson(res, 200, patient);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/patients") {
    readJson(req, (error, patient) => {
      if (error || !patient.email || !patient.name) {
        sendJson(res, error?.code === "request_too_large" ? 413 : 400, { error: "invalid_patient" });
        return;
      }
      const email = String(patient.email).trim().toLowerCase();
      const patients = readPatients();
      patients[email] = { ...patient, email };
      writePatients(patients);
      sendJson(res, 200, patients[email]);
    });
    return true;
  }

  return false;
}

function isPublicPath(pathname) {
  if (["/index.html", "/app.js", "/styles.css"].includes(pathname)) return true;
  if (pathname.startsWith("/assets/")) return true;
  if (pathname.startsWith("/media/memories/")) return true;
  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (handleApi(req, res, url)) return;

  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  if (!isPublicPath(pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const absolute = path.resolve(root, `.${pathname}`);
  if (!absolute.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolute, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(absolute)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

server.listen(port, "0.0.0.0", () => {
  const config = geminiConfig();
  console.log("Bookmark Care app is running.");
  console.log("Laptop: http://localhost:" + port);
  for (const ip of localIps()) console.log("Phone:  http://" + ip + ":" + port);
  console.log(`Gemini: ${hasGeminiKey(config.apiKey) ? "ready" : "API key needed in .env"} (${config.model})`);
  console.log("Stop:   Ctrl+C");
});
