const test = require("node:test");
const assert = require("node:assert/strict");
const {
  analyzeMemoryWithGemini,
  normalizeAnalysis
} = require("./gemini-memory");

function rawAnalysis(overrides = {}) {
  return {
    shouldSave: true,
    memoryScore: 88,
    confidence: 91,
    eventType: "family_interaction",
    mood: "joyful",
    title: "함께 웃은 오후",
    summary: "가까운 사람과 함께 웃으며 따뜻한 시간을 보냈어요.",
    place: "일상 속 공간",
    reason: "긍정적인 상호작용과 웃는 장면이 연속해서 확인됩니다.",
    clearPositiveInteraction: true,
    distinctMemoryCue: true,
    distinctEvent: true,
    routineScene: false,
    safetyFlags: [],
    representativeFrameIndex: 0,
    ...overrides
  };
}

test("accepts a high-confidence positive memory from Gemini", async () => {
  let sentBody;
  const fetchImpl = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(rawAnalysis()) }] } }]
      })
    };
  };

  const result = await analyzeMemoryWithGemini({
    apiKey: "test-api-key",
    frames: [{ mimeType: "image/jpeg", data: "/9j/2Q==" }],
    patientName: "테스트 환자",
    capturedAt: "2026-07-14T08:00:00+09:00",
    fetchImpl
  });

  assert.equal(result.analysis.shouldSave, true);
  assert.equal(result.analysis.memoryScore, 88);
  assert.equal(sentBody.contents[0].parts[1].inline_data.mime_type, "image/jpeg");
  assert.equal(sentBody.generationConfig.responseFormat.text.mimeType, "application/json");
});

test("falls back to Gemini legacy structured output without unsupported schema fields", async () => {
  const sentBodies = [];
  const fetchImpl = async (_url, options) => {
    sentBodies.push(JSON.parse(options.body));
    if (sentBodies.length === 1) {
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: { message: "Unknown name responseFormat" } })
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(rawAnalysis()) }] } }]
      })
    };
  };

  const result = await analyzeMemoryWithGemini({
    apiKey: "test-api-key",
    frames: [{ mimeType: "image/jpeg", data: "/9j/2Q==" }],
    fetchImpl
  });

  assert.equal(result.analysis.shouldSave, true);
  assert.equal(sentBodies.length, 2);
  assert.equal(sentBodies[1].generationConfig.responseMimeType, "application/json");
  assert.equal("additionalProperties" in sentBodies[1].generationConfig.responseSchema, false);
});

test("server-side rules reject a model-approved result below the score threshold", () => {
  const analysis = normalizeAnalysis(rawAnalysis({ memoryScore: 77 }), {
    frameCount: 3,
    scoreThreshold: 78,
    confidenceThreshold: 75
  });
  assert.equal(analysis.shouldSave, false);
});

test("server-side rules reject any result with a safety flag", () => {
  const analysis = normalizeAnalysis(rawAnalysis({ safetyFlags: ["privacy"] }), {
    frameCount: 3,
    scoreThreshold: 78,
    confidenceThreshold: 75
  });
  assert.equal(analysis.shouldSave, false);
  assert.deepEqual(analysis.safetyFlags, ["privacy"]);
});

test("server-side rules reject routine daily scenes even if Gemini recommends saving", () => {
  const analysis = normalizeAnalysis(rawAnalysis({ routineScene: true }), {
    frameCount: 3,
    scoreThreshold: 78,
    confidenceThreshold: 75
  });
  assert.equal(analysis.shouldSave, false);
});

test("server-side rules accept a calm but distinctive memory scene", () => {
  const analysis = normalizeAnalysis(rawAnalysis({
    eventType: "calm_moment",
    mood: "calm",
    clearPositiveInteraction: false,
    distinctMemoryCue: true,
    distinctEvent: true
  }), {
    frameCount: 3,
    scoreThreshold: 78,
    confidenceThreshold: 75
  });
  assert.equal(analysis.shouldSave, true);
  assert.equal(analysis.evidenceCount, 2);
});

test("server-side evidence rules override an inconsistent shouldSave flag", () => {
  const analysis = normalizeAnalysis(rawAnalysis({ shouldSave: false }), {
    frameCount: 3,
    scoreThreshold: 78,
    confidenceThreshold: 75
  });
  assert.equal(analysis.shouldSave, true);
});

test("server-side rules reject a calm scene with only one memory signal", () => {
  const analysis = normalizeAnalysis(rawAnalysis({
    eventType: "calm_moment",
    mood: "calm",
    clearPositiveInteraction: false,
    distinctMemoryCue: true,
    distinctEvent: false
  }), {
    frameCount: 3,
    scoreThreshold: 78,
    confidenceThreshold: 75
  });
  assert.equal(analysis.shouldSave, false);
});
