const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const PROMPT_VERSION = "bookmark-memory-v3-meaningful";
const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_SCORE_THRESHOLD = 78;
const DEFAULT_CONFIDENCE_THRESHOLD = 75;

const SAFETY_FLAGS = [
  "privacy",
  "distress",
  "conflict",
  "fall_or_emergency",
  "camera_obstructed",
  "unclear"
];

const EVENT_TYPES = [
  "family_interaction",
  "celebration",
  "meaningful_conversation",
  "familiar_activity",
  "calm_moment",
  "ordinary",
  "unsafe",
  "unclear"
];

const MOODS = ["joyful", "calm", "connected", "neutral", "distressed", "unclear"];

const SAVEABLE_EVENT_TYPES = new Set([
  "family_interaction",
  "celebration",
  "meaningful_conversation",
  "familiar_activity",
  "calm_moment"
]);

const SAVEABLE_MOODS = new Set(["joyful", "connected", "calm", "neutral"]);

const MEMORY_SCHEMA = {
  type: "object",
  properties: {
    shouldSave: { type: "boolean" },
    memoryScore: { type: "integer", minimum: 0, maximum: 100 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    eventType: { type: "string", enum: EVENT_TYPES },
    mood: { type: "string", enum: MOODS },
    title: { type: "string" },
    summary: { type: "string" },
    place: { type: "string" },
    reason: { type: "string" },
    clearPositiveInteraction: { type: "boolean" },
    distinctMemoryCue: { type: "boolean" },
    distinctEvent: { type: "boolean" },
    routineScene: { type: "boolean" },
    safetyFlags: {
      type: "array",
      items: { type: "string", enum: SAFETY_FLAGS }
    },
    representativeFrameIndex: { type: "integer", minimum: 0 }
  },
  required: [
    "shouldSave",
    "memoryScore",
    "confidence",
    "eventType",
    "mood",
    "title",
    "summary",
    "place",
    "reason",
    "clearPositiveInteraction",
    "distinctMemoryCue",
    "distinctEvent",
    "routineScene",
    "safetyFlags",
    "representativeFrameIndex"
  ]
};

function buildMemoryPrompt({ patientName, capturedAt, frameCount, hasAudio, scoreThreshold, confidenceThreshold }) {
  return `당신은 치매 환자의 회상과 정서 안정을 돕는 '추억 영상 큐레이터'입니다.
입력된 JPEG 이미지들은 목걸이 카메라 영상에서 시간순으로 뽑은 프레임입니다. ${hasAudio ? "마지막 입력에는 같은 시간대의 WAV 오디오도 있습니다." : "오디오는 제공되지 않았습니다."}

[분석 대상]
- 환자 표시 이름: ${patientName || "이름 미상"}
- 촬영 시각: ${capturedAt || "시각 미상"}
- 프레임 수: ${frameCount}
- 프레임 인덱스: 첫 이미지가 0, 마지막 이미지가 ${Math.max(0, frameCount - 1)}입니다.

[목표]
영상 전체의 흐름을 시간순으로 보고, 환자가 나중에 다시 보았을 때 과거를 떠올릴 단서가 되거나 오늘의 기억에 남을 만한 장면인지 판별하세요. 반드시 즐겁거나 웃는 장면일 필요는 없습니다. 차분하거나 진지한 순간도 개인적 의미, 특별한 사건, 구체적인 기억 단서가 있으면 높게 평가하세요.

[높게 평가할 장면]
- 생일, 기념일, 가족 방문, 선물, 공연, 여행, 행사, 새로운 장소처럼 평소와 구분되는 사건이 명확한 순간
- 두 명 이상이 서로 웃거나 반응하며 긍정적인 교류가 연속해서 확인되는 순간
- 이름, 과거 사건, 익숙한 노래·장소·물건처럼 구체적인 기억 단서가 장면이나 음성에 확인되는 순간
- 감사, 칭찬, 위로, 애정 표현처럼 정서적 유대가 말이나 행동으로 분명히 드러나는 순간
- 오래 간직할 만한 인물 사진, 함께 만든 결과물, 풍경, 공연 장면처럼 나중에 다시 이야기할 소재가 분명한 순간
- 차분하거나 중립적인 표정이어도 특별한 사건이나 구체적인 기억 단서가 분명한 순간

[저장하지 않을 장면]
- 빈 공간, 이동 중 흔들림, 심한 흐림, 렌즈 가림처럼 사건을 알 수 없는 영상
- 식사, 걷기, TV 시청, 앉아 있기, 이동, 혼자 하는 활동, 짧은 일상 대화처럼 평범하게 반복되는 일상
- 사람이 함께 있거나 미소가 한 번 보이는 것만으로는 저장하지 않음
- 편안하거나 평온해 보이더라도 구체적인 사건·상호작용·기억 단서가 없으면 저장하지 않음
- 잠자는 모습, 반복적인 무의미한 장면, 기억 단서가 거의 없는 평범한 이동
- 화장실, 탈의, 신체 노출, 의료 처치 등 사생활 침해 가능성이 있는 장면
- 다툼, 심한 불안·고통, 낙상·응급상황 등 환자에게 다시 보여주기 부적절한 장면
- 맥락이나 감정을 확신할 수 없는 장면

[점수 기준]
- 90~100: 특별한 사건과 개인적 기억 단서가 매우 분명하고 오래 남길 가치가 큼
- ${scoreThreshold}~89: 아래의 강한 근거 3개 중 2개 이상이 분명하여 다시 볼 가치가 충분한 순간
- 50~${scoreThreshold - 1}: 일부 긍정 단서는 있으나 평범하거나 근거가 부족함
- 0~49: 무의미, 불명확, 부정적, 위험 또는 사생활 문제

[필수 규칙]
- 보이는 장면과 들리는 소리에 근거해서만 판단하고, 보이지 않는 사실을 지어내지 마세요.
- 얼굴만 보고 사람의 신원, 관계, 질병, 감정을 단정하지 마세요. 의학적 진단도 하지 마세요.
- 저장 근거는 다음 3개입니다: clearPositiveInteraction, distinctMemoryCue, distinctEvent. 이 중 최소 2개가 true여야 합니다.
- clearPositiveInteraction은 상호적인 웃음·대화·애정 표현이 연속해서 명확할 때만 true입니다.
- distinctMemoryCue는 특정 인물·장소·물건·노래·과거 사건 등 나중에 회상을 도울 구체적 단서가 확인될 때만 true입니다.
- distinctEvent는 기념일, 방문, 여행, 행사, 공연, 선물, 완성된 활동처럼 평범한 반복 일상과 구분되는 사건이나 기록할 장면이면 true입니다.
- routineScene은 반복되는 평범한 일상이라면 true입니다. routineScene이 true이면 shouldSave는 반드시 false입니다.
- 강한 근거가 2개 이상이고 routineScene이 false이며 안전 문제가 없다면 memoryScore를 ${scoreThreshold} 이상으로 평가하고 shouldSave를 true로 응답하세요.
- eventType이 ordinary, unsafe, unclear 중 하나이면 shouldSave는 반드시 false입니다. calm_moment는 강한 근거가 2개 이상이면 저장할 수 있습니다.
- mood가 calm 또는 neutral이라는 이유만으로 점수를 낮추지 마세요. distressed 또는 unclear이면 저장하지 마세요.
- 이미지가 한 장뿐이어도 보이는 사건과 기억 단서가 명확하다면 프레임 수가 적다는 이유만으로 점수를 낮추지 마세요.
- 안전 플래그가 하나라도 있으면 shouldSave는 반드시 false입니다.
- confidence가 ${confidenceThreshold} 미만이면 shouldSave는 반드시 false입니다.
- memoryScore가 ${scoreThreshold} 미만이면 shouldSave는 반드시 false입니다.
- 강한 근거가 하나뿐이거나 반복 일상과 구분되지 않으면 shouldSave를 false로 판단하세요.
- 저장하는 경우 title은 24자 이내의 따뜻한 한국어, summary는 환자에게 직접 들려줄 수 있는 사실적인 한국어 1~2문장으로 작성하세요.
- place는 영상에서 확실할 때만 구체적으로 쓰고, 불확실하면 '일상 속 공간'이라고 쓰세요.
- representativeFrameIndex는 장면의 의미가 가장 잘 드러나는 프레임 번호입니다.
- reason은 보호자가 판단 근거를 이해할 수 있게 짧고 구체적인 한국어로 작성하세요.

반드시 지정된 JSON 스키마로만 응답하세요.`;
}

function clampInteger(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function cleanText(value, fallback, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim() || fallback;
  return text.slice(0, maxLength);
}

function normalizeAnalysis(raw, { frameCount, scoreThreshold, confidenceThreshold }) {
  const memoryScore = clampInteger(raw.memoryScore, 0, 100);
  const confidence = clampInteger(raw.confidence, 0, 100);
  const eventType = EVENT_TYPES.includes(raw.eventType) ? raw.eventType : "unclear";
  const mood = MOODS.includes(raw.mood) ? raw.mood : "unclear";
  const safetyFlags = [...new Set(
    (Array.isArray(raw.safetyFlags) ? raw.safetyFlags : [])
      .map((flag) => SAFETY_FLAGS.includes(flag) ? flag : "unclear")
  )];

  if (eventType === "unsafe" && safetyFlags.length === 0) safetyFlags.push("distress");
  if (mood === "distressed" && safetyFlags.length === 0) safetyFlags.push("distress");

  const clearPositiveInteraction = raw.clearPositiveInteraction === true;
  const distinctMemoryCue = raw.distinctMemoryCue === true;
  const distinctEvent = raw.distinctEvent === true;
  const routineScene = raw.routineScene !== false;
  const evidenceCount = [clearPositiveInteraction, distinctMemoryCue, distinctEvent]
    .filter(Boolean).length;

  const shouldSave = memoryScore >= scoreThreshold
    && confidence >= confidenceThreshold
    && safetyFlags.length === 0
    && SAVEABLE_EVENT_TYPES.has(eventType)
    && SAVEABLE_MOODS.has(mood)
    && evidenceCount >= 2
    && !routineScene;

  return {
    shouldSave,
    memoryScore,
    confidence,
    eventType,
    mood,
    title: cleanText(raw.title, "오늘의 좋은 순간", 24),
    summary: cleanText(raw.summary, "오늘 기록된 따뜻한 순간입니다.", 180),
    place: cleanText(raw.place, "일상 속 공간", 30),
    reason: cleanText(raw.reason, "영상의 맥락을 충분히 확인하지 못했습니다.", 180),
    clearPositiveInteraction,
    distinctMemoryCue,
    distinctEvent,
    evidenceCount,
    routineScene,
    safetyFlags,
    representativeFrameIndex: clampInteger(raw.representativeFrameIndex, 0, Math.max(0, frameCount - 1))
  };
}

function parseCandidateJson(payload) {
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) throw createGeminiError("gemini_empty_response", 502, "Gemini가 분석 결과를 반환하지 않았습니다.");

  const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(withoutFence);
  } catch {
    throw createGeminiError("gemini_invalid_json", 502, "Gemini 분석 결과가 올바른 JSON이 아닙니다.");
  }
}

function createGeminiError(code, status, message, details = "") {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

async function requestGemini({ apiKey, model, body, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const responseText = await response.text();
    let payload = {};
    try { payload = JSON.parse(responseText); }
    catch { payload = { raw: responseText }; }

    if (!response.ok) {
      const details = payload?.error?.message || responseText || `HTTP ${response.status}`;
      throw createGeminiError("gemini_request_failed", response.status || 502, "Gemini 분석 요청에 실패했습니다.", details);
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw createGeminiError("gemini_timeout", 504, "Gemini 분석 시간이 초과되었습니다.");
    }
    if (error.code) throw error;
    throw createGeminiError("gemini_unreachable", 502, "Gemini 서버에 연결하지 못했습니다.", error.message);
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeMemoryWithGemini({
  apiKey,
  model = DEFAULT_MODEL,
  frames,
  audio,
  patientName,
  capturedAt,
  scoreThreshold = DEFAULT_SCORE_THRESHOLD,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
  timeoutMs = 35_000,
  fetchImpl = globalThis.fetch
}) {
  if (!apiKey || /^여기에_|^your_|^put_/i.test(apiKey)) {
    throw createGeminiError("gemini_key_missing", 503, "Gemini API 키가 설정되지 않았습니다.");
  }
  if (typeof fetchImpl !== "function") {
    throw createGeminiError("fetch_unavailable", 500, "이 Node.js 버전에서는 fetch를 사용할 수 없습니다.");
  }
  if (!Array.isArray(frames) || frames.length === 0) {
    throw createGeminiError("video_frames_missing", 400, "분석할 영상 프레임이 없습니다.");
  }

  const prompt = buildMemoryPrompt({
    patientName,
    capturedAt,
    frameCount: frames.length,
    hasAudio: Boolean(audio),
    scoreThreshold,
    confidenceThreshold
  });
  const parts = [
    { text: prompt },
    ...frames.map((frame) => ({
      inline_data: { mime_type: frame.mimeType, data: frame.data }
    }))
  ];
  if (audio) parts.push({ inline_data: { mime_type: audio.mimeType, data: audio.data } });

  const generationConfig = {
    temperature: 0.2,
    responseFormat: {
      text: {
        mimeType: "application/json",
        schema: MEMORY_SCHEMA
      }
    }
  };
  const requestBody = {
    contents: [{ role: "user", parts }],
    generationConfig
  };

  let payload;
  try {
    payload = await requestGemini({ apiKey, model, body: requestBody, timeoutMs, fetchImpl });
  } catch (error) {
    // Some older generateContent deployments still use the legacy structured-output fields.
    if (error.status !== 400 || !/responseFormat|unknown name|unknown field/i.test(error.details || "")) throw error;
    payload = await requestGemini({
      apiKey,
      model,
      timeoutMs,
      fetchImpl,
      body: {
        contents: requestBody.contents,
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: MEMORY_SCHEMA
        }
      }
    });
  }

  const analysis = normalizeAnalysis(parseCandidateJson(payload), {
    frameCount: frames.length,
    scoreThreshold,
    confidenceThreshold
  });
  return { analysis, model, promptVersion: PROMPT_VERSION };
}

module.exports = {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_MODEL,
  DEFAULT_SCORE_THRESHOLD,
  MEMORY_SCHEMA,
  PROMPT_VERSION,
  analyzeMemoryWithGemini,
  buildMemoryPrompt,
  normalizeAnalysis
};
