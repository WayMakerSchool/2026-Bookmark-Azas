const BLE_SERVICE = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const BLE_CHAR = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
const DEVICE_BASE = "http://192.168.4.1";
const DEMO_EMAIL = "demo@bookmark.care";
const NECKLACE_WIFI_SSID = "Bookmark_Necklace";
const NECKLACE_WIFI_PASSWORD = "12345678";
const MANUAL_CAPTURE_FLOW_VERSION = 2;
const LIVE_PREVIEW_INTERVAL_MS = 180;
const TUTORIAL_STORAGE_KEY = "bookmarkTutorialSeenV2";

const demoMemories = [
  {
    id: "m-party",
    title: "가족들과 함께한 생일 파티",
    date: "2026.07.13",
    place: "우리 집 거실",
    mood: "웃음 반응 높음",
    type: "party",
    favorite: true,
    image: "assets/family-birthday.png",
    script: "민수와 손주들이 케이크를 준비했어요. 어머니가 촛불을 보고 환하게 웃으셨습니다."
  },
  {
    id: "m-stage",
    title: "오랜만에 함께 부른 노래",
    date: "2026.07.12",
    place: "동네 문화센터",
    mood: "안정 반응",
    type: "stage",
    favorite: false,
    image: "assets/community-stage.png",
    script: "익숙한 노래가 나오자 천천히 따라 부르셨어요. 재생 후 표정이 한결 편안해졌습니다."
  },
  {
    id: "m-tea",
    title: "손주와 나눈 오후 간식",
    date: "2026.07.10",
    place: "주방",
    mood: "대화 증가",
    type: "calm",
    favorite: true,
    image: "assets/family-birthday.png",
    script: "손주가 과자를 건네자 이름을 불러주셨어요. 짧지만 따뜻한 대화가 이어졌습니다."
  }
];

const state = {
  route: "auth",
  authMode: "role",
  role: null,
  tab: "home",
  email: null,
  patient: null,
  selectedMemoryId: "m-party",
  search: "",
  favoriteOnly: false,
  profileFilter: "mine",
  tutorialStep: null,
  modal: null,
  playing: false,
  audioUrl: null,
  frameUrls: [],
  pendingCapture: null,
  analysisRunning: false,
  lastAnalysis: null,
  liveMode: "stream",
  liveAnalysis: null,
  device: {
    ble: false,
    softap: false,
    softapConnecting: false,
    wifi: false,
    battery: 95,
    temperature: 32.8,
    camera: false,
    microphone: false,
    reactions: 2
  }
};

let livePreviewTimer = null;
let livePreviewGeneration = 0;
let livePreviewFailureCount = 0;
let pendingAnalysisRetryTimer = null;
let softApConnectTimer = null;
let necklaceSyncInProgress = false;
let memoryPlaybackTimer = null;
let memoryPlaybackAudio = null;
let bleDevice = null;
let bleCharacteristic = null;

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

const store = {
  get patients() {
    try { return JSON.parse(localStorage.getItem("bookmarkPatients") || "{}"); }
    catch { return {}; }
  },
  set patients(value) { localStorage.setItem("bookmarkPatients", JSON.stringify(value)); },
  get analyses() {
    try { return JSON.parse(localStorage.getItem("bookmarkLastAnalyses") || "{}"); }
    catch { return {}; }
  },
  set analyses(value) { localStorage.setItem("bookmarkLastAnalyses", JSON.stringify(value)); },
  get session() {
    try { return JSON.parse(localStorage.getItem("bookmarkSession") || "null"); }
    catch { return null; }
  },
  set session(value) {
    if (value) localStorage.setItem("bookmarkSession", JSON.stringify(value));
    else localStorage.removeItem("bookmarkSession");
  },
  get wifiReturn() {
    try {
      return {
        enabled: true,
        ssid: "",
        ...JSON.parse(localStorage.getItem("bookmarkWifiReturn") || "{}")
      };
    } catch {
      return { enabled: true, ssid: "" };
    }
  },
  set wifiReturn(value) {
    localStorage.setItem("bookmarkWifiReturn", JSON.stringify(value));
  }
};

function cloneMemories() {
  return demoMemories.map((memory) => ({ ...memory }));
}

function normalizePatient(patient) {
  if (!patient) return null;
  const memories = Array.isArray(patient.memories) ? patient.memories : cloneMemories();
  return {
    registeredAt: "2026.07.13",
    birthDate: patient.birthDate || (patient.birth ? `${patient.birth}-01-01` : "1954-04-01"),
    guardianPhone: "010-1234-5678",
    ...patient,
    memories: memories.map((memory, index) => ({
      favorite: index === 0,
      image: memory.type === "stage" ? "assets/community-stage.png" : "assets/family-birthday.png",
      ...memory
    }))
  };
}

function seed() {
  const patients = store.patients;
  patients[DEMO_EMAIL] = normalizePatient(patients[DEMO_EMAIL] || {
    email: DEMO_EMAIL,
    name: "김영숙",
    birthDate: "1954-04-01",
    diagnosis: "경증 치매",
    guardian: "김민수",
    relation: "아들",
    guardianPhone: "010-1234-5678",
    registeredAt: "2026.07.13",
    note: "오후 3시 이후 불안감이 높아지고, 가족 생일 사진과 익숙한 노래에 안정 반응을 보입니다.",
    memories: cloneMemories()
  });
  store.patients = patients;
}

function icon(name, size = 20) {
  const paths = {
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-2.9 1.1V21h-4v-.2a1.7 1.7 0 0 0-2.9-1.1l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 3.2 14H3v-4h.2a1.7 1.7 0 0 0 1.1-2.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 10 3.2V3h4v.2a1.7 1.7 0 0 0 2.9 1.1l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0 1.1 2.9h.2v4h-.2a1.7 1.7 0 0 0-1.4 1Z"/>',
    play: '<polygon points="8 5 19 12 8 19 8 5"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01"/>',
    camera: '<path d="M14.5 5 16 8h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3l1.5-3Z"/><circle cx="12" cy="14" r="3"/>',
    rotate: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.7-2.6L20 9M4 15l2.2 2.6A7 7 0 0 0 17.9 15"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2A5 5 0 0 0 12 3.9L10.9 5M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    log: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.5 2.1c-.8.4-1.3.8-1.3 1.9M12 17h.01"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function getPatient(email = state.email) {
  return normalizePatient(store.patients[email] || null);
}

function getStoredLastAnalysis(email = state.email) {
  return email ? store.analyses[email] || null : null;
}

function saveLastAnalysis(analysis) {
  const saved = { ...analysis, analyzedAt: analysis.analyzedAt || new Date().toISOString() };
  state.lastAnalysis = saved;
  if (state.email) {
    const analyses = store.analyses;
    analyses[state.email] = saved;
    store.analyses = analyses;
  }
  return saved;
}

function savePatient(patient, sync = true) {
  const normalized = normalizePatient(patient);
  const patients = store.patients;
  patients[normalized.email] = normalized;
  store.patients = patients;
  if (sync) syncPatientToServer(normalized);
  return normalized;
}

async function syncPatientToServer(patient) {
  try {
    const response = await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patient)
    });
    if (!response.ok) throw new Error("sync_failed");
    return true;
  } catch {
    // Local storage keeps the demo usable when the laptop server is unavailable.
    return false;
  }
}

async function fetchPatientFromServer(email) {
  try {
    const response = await fetch(`/api/patients/${encodeURIComponent(email)}`);
    if (!response.ok) return null;
    return savePatient(await response.json(), false);
  } catch {
    return null;
  }
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2400);
}

function setSession(role, email, patient = getPatient(email)) {
  state.role = role;
  state.email = email;
  state.patient = normalizePatient(patient);
  state.lastAnalysis = getStoredLastAnalysis(email);
  state.route = "app";
  state.tab = role === "caregiver" ? "profile" : "home";
  state.selectedMemoryId = state.patient.memories[0]?.id || null;
  state.tutorialStep = role === "patient" && !localStorage.getItem(TUTORIAL_STORAGE_KEY) ? "feed" : null;
  store.session = { role, email };
  render();
  if (role === "patient") {
    restorePendingCapture(email);
  }
}

function logout() {
  stopMemoryPlaybackMedia();
  clearTimeout(pendingAnalysisRetryTimer);
  pendingAnalysisRetryTimer = null;
  if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
  bleDevice = null;
  bleCharacteristic = null;
  store.session = null;
  Object.assign(state, {
    route: "auth", authMode: "role", role: null, email: null, patient: null,
    tab: "home", search: "", favoriteOnly: false, profileFilter: "mine", modal: null, tutorialStep: null,
    playing: false, pendingCapture: null, analysisRunning: false, lastAnalysis: null,
    liveMode: "stream", liveAnalysis: null
  });
  stopSoftApConnectionWatcher();
  Object.assign(state.device, { ble: false, softap: false, softapConnecting: false, wifi: false, camera: false, microphone: false });
  render();
}

function render() {
  stopMemoryPlaybackMedia();
  if (state.modal !== "live") stopLivePreview();
  app.innerHTML = state.route === "auth" ? renderAuth() : renderApp();
  bind();
  if (state.route === "app" && state.playing) startMemoryPlayback(currentMemory());
}

function renderAuth() {
  if (state.authMode === "patient-register") return authShell(patientRegister());
  if (state.authMode === "patient-login") return authShell(patientLogin());
  if (state.authMode === "caregiver-login") return authShell(caregiverLogin());
  return `
    <section class="auth-screen">
      <div class="auth-visual">
        <div class="auth-mark">B</div>
        <div><p class="eyebrow light">BOOKMARK CARE</p><h1>오늘의 좋은 기억을<br>다시 만나요</h1></div>
      </div>
      <div class="auth-panel">
        <p class="auth-title">앱을 사용할 분을 선택해주세요</p>
        <button class="role-choice patient" data-auth="patient-register">
          <span class="role-icon">${icon("user", 24)}</span><span><strong>환자</strong><small>추억 영상 보기</small></span>${icon("chevron")}
        </button>
        <button class="role-choice" data-auth="caregiver-login">
          <span class="role-icon">${icon("link", 24)}</span><span><strong>보호자</strong><small>환자 상태 관리</small></span>${icon("chevron")}
        </button>
      </div>
    </section>`;
}

function authShell(inner) {
  return `
    <section class="plain-screen">
      <header class="plain-header">
        <button class="icon-button" data-auth="role" aria-label="뒤로">${icon("back")}</button>
        <span class="header-mark">B</span>
        <span class="header-space"></span>
      </header>
      <main class="form-page">${inner}</main>
    </section>`;
}

function patientRegister() {
  return `
    <div class="form-heading"><p class="eyebrow">PATIENT</p><h1>환자 정보 등록</h1><p>이 정보로 보호자 앱과 안전하게 연결됩니다.</p></div>
    <form class="form-stack" id="patientForm">
      <label>이메일<input name="email" type="email" required placeholder="patient@email.com" autocomplete="email"></label>
      <label>이름<input name="name" required placeholder="김영숙"></label>
      <div class="field-pair">
        <label>생년월일<input name="birthDate" type="date" required value="1954-04-01"></label>
        <label>진단 단계<select name="diagnosis"><option>경증 치매</option><option>중등도 치매</option><option>중증 치매</option></select></label>
      </div>
      <div class="field-pair">
        <label>보호자 이름<input name="guardian" required placeholder="김민수"></label>
        <label>관계<input name="relation" required placeholder="아들"></label>
      </div>
      <label>보호자 연락처<input name="guardianPhone" inputmode="tel" required placeholder="010-1234-5678"></label>
      <label>돌봄 메모<textarea name="note" placeholder="좋아하는 노래, 편안해지는 시간 등을 적어주세요."></textarea></label>
      <button class="primary-button" type="submit">가입하고 시작하기</button>
      <button class="text-button" type="button" data-auth="patient-login">이미 등록했어요</button>
    </form>`;
}

function patientLogin() {
  return `
    <div class="form-heading"><p class="eyebrow">PATIENT</p><h1>환자 로그인</h1><p>등록한 환자 이메일을 입력해주세요.</p></div>
    <form class="form-stack" id="patientLoginForm">
      <label>이메일<input name="email" type="email" required placeholder="${DEMO_EMAIL}" autocomplete="email"></label>
      <button class="primary-button" type="submit">추억 영상 열기</button>
    </form>`;
}

function caregiverLogin() {
  return `
    <div class="form-heading"><p class="eyebrow">CAREGIVER</p><h1>보호자 연결</h1><p>환자가 가입할 때 사용한 이메일을 입력하면 해당 프로필로 바로 이동합니다.</p></div>
    <form class="form-stack" id="caregiverForm">
      <label>환자 이메일<input name="email" type="email" required placeholder="${DEMO_EMAIL}" autocomplete="email"></label>
      <button class="primary-button" type="submit">환자 프로필 열기</button>
    </form>`;
}

function renderApp() {
  if (!state.patient) return renderAuth();
  const patientApp = state.role === "patient";
  const feedTutorial = patientApp && state.tutorialStep === "feed";
  return `
    <section class="app-screen ${patientApp ? "patient-app" : "caregiver-app"}">
      ${patientApp ? renderPatientContent() : renderCaregiverContent()}
      ${feedTutorial ? "" : bottomNav()}
      ${state.modal ? modalView() : ""}
    </section>`;
}

function bottomNav() {
  const tabs = state.role === "patient"
    ? [["home", "home", "영상 피드"], ["memory", "image", "추억 보관함"]]
    : [["home", "home", "홈"], ["memory", "image", "추억"], ["profile", "user", "프로필"], ["device", "settings", "기기"]];
  return `<nav class="bottom-nav ${state.role}" aria-label="주요 메뉴">${tabs.map(([tab, ico, label]) => `
    <button class="nav-button ${state.tab === tab ? "active" : ""}" data-tab="${tab}" aria-label="${label}" title="${label}">${icon(ico, 19)}<span>${label}</span></button>`).join("")}</nav>`;
}

function renderPatientContent() {
  if (state.tab === "memory") return memoryVault(false);
  if (state.tab === "settings") return patientSettings();
  return patientFeed();
}

function patientFeed() {
  const memories = state.patient.memories;
  const ordered = [...memories].sort((a) => a.id === state.selectedMemoryId ? -1 : 1);
  const tutorial = state.tutorialStep === "feed" ? `
    <button class="feed-slide feed-tutorial-slide" type="button" data-tutorial-finish aria-label="튜토리얼을 마치고 영상 보기">
      <div class="tutorial-feed-copy">
        <strong class="tutorial-swipe-copy">아래쪽으로 손가락을<br>내려서 영상을 확인하세요.</strong>
        <strong class="tutorial-click-copy">화면을 한 번 눌러서<br>영상을 확인하세요.</strong>
        <small class="tutorial-swipe-hint">화면을 끝까지 내려 다음으로 넘어가기</small>
        <small class="tutorial-click-hint">화면을 눌러 바로 영상 보기</small>
        <span class="tutorial-feed-arrows" aria-hidden="true"><i></i><i></i></span>
      </div>
    </button>` : "";
  return `
    <main class="video-feed" id="videoFeed">
      ${tutorial}
      ${ordered.map((memory) => `
        <article class="feed-slide" data-feed-id="${memory.id}">
          <img src="${escapeHtml(memory.image)}" data-memory-frame="${escapeHtml(memory.id)}" alt="${escapeHtml(memory.title)}">
          <div class="feed-shade"></div>
          <div class="phone-status"><span>9:41</span><span class="speaker"></span><span>●</span></div>
          <button class="feed-help" data-tutorial-start aria-label="앱 사용 안내">${icon("help", 19)}</button>
          <button class="feed-settings" data-tab="settings" aria-label="설정">${icon("settings", 19)}</button>
          <button class="feed-heart ${memory.favorite ? "on" : ""}" data-favorite="${memory.id}" aria-label="즐겨찾기">${icon("heart", 21)}</button>
          <button class="feed-play" data-play="${memory.id}" aria-label="추억 재생">${icon(state.playing && state.selectedMemoryId === memory.id ? "pause" : "play", 28)}</button>
          <div class="feed-copy">
            <p>${escapeHtml(memory.date)} · ${escapeHtml(memory.place)}</p>
            <h1>${escapeHtml(memory.title)}</h1>
            <span>${escapeHtml(memory.script)}</span>
          </div>
          <div class="swipe-cue">⌄</div>
        </article>`).join("")}
    </main>`;
}

function appHeader(title, back = false) {
  const action = state.role === "patient" && state.tab !== "settings"
    ? `<button class="icon-button" data-tab="settings" aria-label="설정">${icon("settings")}</button>`
    : `<span class="header-space"></span>`;
  return `
    <header class="app-header">
      ${back ? `<button class="icon-button" data-detail-close aria-label="뒤로">${icon("back")}</button>` : `<span class="brand-symbol">B</span>`}
      <div><p class="eyebrow">BOOKMARK</p><h1>${escapeHtml(title)}</h1></div>
      ${action}
    </header>`;
}

function eventTypeLabel(eventType) {
  return {
    family_interaction: "가족과의 교류",
    celebration: "기념일과 축하",
    meaningful_conversation: "의미 있는 대화",
    familiar_activity: "익숙한 활동",
    calm_moment: "평온한 순간",
    ordinary: "평범한 일상",
    unsafe: "저장 제외 장면",
    unclear: "판단 보류"
  }[eventType] || "장면 확인 중";
}

function latestAiDecision() {
  if (state.lastAnalysis) return state.lastAnalysis;
  if (state.patient?.lastAnalysis) return state.patient.lastAnalysis;
  const latestMemory = state.patient?.memories?.find((memory) => memory.aiAnalysis);
  return latestMemory ? { ...latestMemory.aiAnalysis, saved: true } : null;
}

function liveAiView() {
  if (state.analysisRunning) {
    return {
      tone: "running",
      title: "Gemini가 장면을 판별하고 있어요",
      detail: "인물의 상호작용, 활동 맥락과 정서적 단서를 함께 확인합니다.",
      badge: "분석 중"
    };
  }
  if (state.liveAnalysis) {
    const analysis = state.liveAnalysis;
    return {
      tone: analysis.saved ? "accepted" : "ordinary",
      title: analysis.saved ? "추억으로 남길 만한 순간" : eventTypeLabel(analysis.eventType),
      detail: analysis.reason || "장면의 의미와 저장 가치를 확인했습니다.",
      badge: `${analysis.memoryScore}점`
    };
  }
  if (state.pendingCapture) {
    return {
      tone: "waiting",
      title: "영상 수신 완료, 인터넷 연결 대기",
      detail: "일반 Wi-Fi로 돌아오면 보관된 프레임을 Gemini가 실제로 판별합니다.",
      badge: "대기"
    };
  }
  if (state.liveMode === "receiving") {
    return {
      tone: "running",
      title: "최근 장면을 가져오고 있어요",
      detail: "목걸이의 최근 영상과 음성을 안전하게 수신하는 중입니다.",
      badge: "수신 중"
    };
  }
  const latest = latestAiDecision();
  if (latest) {
    return {
      tone: latest.saved ? "accepted" : "ordinary",
      title: latest.saved
        ? `최근 판단: ${eventTypeLabel(latest.eventType)} 저장`
        : `최근 판단: ${eventTypeLabel(latest.eventType)}`,
      detail: latest.reason || latest.summary || "최근 장면의 추억 가치와 저장 여부를 판정했습니다.",
      badge: Number.isFinite(Number(latest.memoryScore)) ? `${latest.memoryScore}점` : "판정 완료"
    };
  }
  return {
    tone: "waiting",
    title: "최근 AI 판단이 없습니다",
    detail: "최근 장면을 Gemini로 판정하면 결과와 판단 근거가 여기에 표시됩니다.",
    badge: "기록 없음"
  };
}

function analysisPipelineMarkup(dark = false) {
  let currentStep = 0;
  if (state.liveMode === "receiving") currentStep = 1;
  if (state.pendingCapture) currentStep = 2;
  if (state.analysisRunning || state.liveMode === "analyzing") currentStep = 3;
  if (state.liveMode === "result") currentStep = 4;

  const steps = [
    { label: "영상 수신", symbol: icon("camera", 13) },
    { label: "Wi-Fi 복귀", symbol: icon("wifi", 13) },
    { label: "Gemini 분석", symbol: "AI" },
    { label: "저장 판정", symbol: icon("check", 13) }
  ];
  return `<ol class="analysis-pipeline ${dark ? "dark" : ""}" aria-label="AI 분석 진행 단계">
    ${steps.map((step, index) => {
      const number = index + 1;
      const status = currentStep > number ? "done" : currentStep === number ? "active" : "";
      return `<li class="${status}" ${currentStep === number ? 'aria-current="step"' : ""}><span>${step.symbol}</span><b>${step.label}</b></li>`;
    }).join("")}
  </ol>`;
}

function patientSettings() {
  const connected = state.device.softap;
  const pending = state.pendingCapture;
  const analysis = state.lastAnalysis;
  const wifiReturn = store.wifiReturn;
  const returnTarget = wifiReturn.ssid || "휴대폰에 저장된 기본 Wi-Fi";
  return `
    ${appHeader("연결 및 설정")}
    <main class="page patient-settings">
      <section class="softap-hero ${connected ? "connected" : ""}">
        <span class="necklace-icon">B</span>
        <div><small>BOOKMARK NECKLACE</small><h2>${connected ? "카메라 연결됨" : "카메라 연결 대기"}</h2><p>${connected ? "목걸이의 최근 기록을 가져올 수 있어요." : "목걸이 전원을 켜고 Wi-Fi에 연결해주세요."}</p></div>
        <em>${connected ? "연결" : "대기"}</em>
      </section>

      <section class="wifi-panel">
        <div class="settings-heading"><div><small>STEP 1</small><h3>목걸이 Wi-Fi 연결</h3></div>${icon("wifi", 20)}</div>
        <p class="settings-copy">이 앱 화면을 닫지 말고 휴대폰 Wi-Fi 설정에서 아래 네트워크를 선택해주세요.</p>
        <dl class="network-info">
          <div><dt>Wi-Fi 이름</dt><dd>${NECKLACE_WIFI_SSID}</dd></div>
          <div><dt>비밀번호</dt><dd>${NECKLACE_WIFI_PASSWORD} <button data-copy-password aria-label="비밀번호 복사">${icon("copy", 15)}</button></dd></div>
          <div><dt>카메라 주소</dt><dd>192.168.4.1</dd></div>
        </dl>
        <div class="softap-connect-actions">
          <button class="primary-button" data-softap-connect ${state.device.softapConnecting || connected ? "disabled" : ""}>${icon(connected ? "check" : "wifi", 18)} ${connected ? `${NECKLACE_WIFI_SSID} 연결됨` : state.device.softapConnecting ? "연결을 기다리는 중..." : `${NECKLACE_WIFI_SSID} 자동 연결`}</button>
          <button class="icon-button" data-softap-check aria-label="Wi-Fi 연결 상태 확인" title="연결 상태 확인">${icon("rotate", 18)}</button>
        </div>
        ${state.device.softapConnecting ? `<p class="softap-connect-wait">Wi-Fi 화면에서 ${NECKLACE_WIFI_SSID}를 선택하면 앱이 자동으로 연결을 확인합니다.</p>` : ""}
        <form class="wifi-return-form" id="wifiReturnForm">
          <div class="wifi-return-head">
            <div><strong>일반 Wi-Fi 자동 복귀</strong><span>분석 버튼을 누르면 영상 수신 후 목걸이 Wi-Fi를 45초간 끕니다.</span></div>
            <span class="wifi-return-fixed">항상 사용</span>
          </div>
          <label class="wifi-name-field"><span>자동 연결 대상 Wi-Fi 이름</span><input name="ssid" value="${escapeHtml(wifiReturn.ssid)}" placeholder="예: 우리집_WiFi" autocomplete="off"></label>
          <p>목표: <strong>${escapeHtml(returnTarget)}</strong> · 휴대폰에 저장하고 자동 연결을 켜야 합니다. 웹 앱은 운영체제의 SSID 선택을 강제할 수 없습니다.</p>
          <div class="wifi-return-actions">
            <button type="submit" class="primary-button">${icon("check", 17)} 자동 복귀 설정 저장</button>
            <button type="button" class="icon-button" data-open-wifi-settings aria-label="휴대폰 Wi-Fi 설정 열기" title="Wi-Fi 설정 열기">${icon("settings", 18)}</button>
          </div>
        </form>
      </section>

      <section class="live-panel">
        <div class="settings-heading"><div><small>STEP 2</small><h3>실시간 카메라 확인</h3></div>${icon("camera", 20)}</div>
        <p class="settings-copy">목걸이가 지금 촬영하고 있는 화면을 환자 앱에서 확인합니다.</p>
        <button class="primary-button" data-live-open>${icon("camera", 18)} 카메라 실시간 보기</button>
      </section>

      <section class="capture-panel">
        <div class="settings-heading"><div><small>STEP 3</small><h3>AI 추억 영상 분석</h3></div>${icon("image", 20)}</div>
        <p class="settings-copy">버튼을 누르면 최근 30초를 수신하고, 일반 Wi-Fi 복귀 후 Gemini가 저장 여부를 판별합니다.</p>
        ${analysisPipelineMarkup()}
        ${pending ? `
          <div class="analysis-state pending">
            <span class="analysis-state-icon">AI</span>
            <div><strong>${state.analysisRunning ? "Gemini 분석 중" : "영상 수신 완료"}</strong><p>${state.analysisRunning ? "추억으로 남길 장면인지 확인하고 있어요." : "일반 Wi-Fi로 돌아온 뒤 분석을 계속해주세요."}</p></div>
            <em>${Math.max(1, Math.round((pending.durationMs || 0) / 1000))}초</em>
          </div>
          <button class="primary-button" data-analyze-pending ${state.analysisRunning ? "disabled" : ""}>${icon("check", 18)} ${state.analysisRunning ? "분석 중..." : "Gemini 분석 계속"}</button>
        ` : `
          ${analysis ? `<div class="analysis-state ${analysis.saved ? "accepted" : "rejected"}"><span class="analysis-state-icon">AI</span><div><strong>${analysis.saved ? "추억 영상으로 저장했어요" : eventTypeLabel(analysis.eventType)}</strong><p>${escapeHtml(analysis.reason)}</p></div><em>${analysis.memoryScore}점</em></div>` : ""}
          <button class="outline-button" data-sync>${icon("camera", 18)} 최근 30초 분석</button>
        `}
      </section>

      <button class="outline-button wide" data-ble>${icon(state.device.ble ? "check" : "link", 18)} ${state.device.ble ? "Bluetooth 상태 연결됨" : "Bluetooth 상태 연결"}</button>
      <button class="logout-button patient-logout" data-logout>${icon("log", 17)} 로그아웃</button>
    </main>`;
}

function memoryVault(caregiver) {
  if (state.modal === "detail") return memoryDetail(caregiver);
  const query = state.search.trim().toLowerCase();
  const memories = state.patient.memories.filter((memory) => {
    const matchesQuery = [memory.title, memory.place, memory.date].join(" ").toLowerCase().includes(query);
    return matchesQuery && (!state.favoriteOnly || memory.favorite);
  });
  return `
    ${appHeader("추억 보관함")}
    <main class="page memory-page">
      <label class="search-box">${icon("search", 17)}<input id="memorySearch" value="${escapeHtml(state.search)}" placeholder="추억을 검색해보세요" aria-label="추억 검색"></label>
      <div class="memory-tools">
        <button class="filter-button ${state.favoriteOnly ? "active" : ""}" data-filter-favorite>${icon("heart", 14)} 즐겨찾기만 보기</button>
        <span>${memories.length}개의 추억</span>
      </div>
      <div class="memory-list">
        ${memories.length ? memories.map((memory) => memoryCard(memory, caregiver)).join("") : `<div class="empty-state">조건에 맞는 추억이 없습니다.</div>`}
      </div>
      ${caregiver ? `<button class="floating-add" data-modal="add" aria-label="추억 추가">${icon("plus", 22)}</button>` : ""}
    </main>`;
}

function memoryCard(memory, caregiver = false) {
  return `
    <article class="memory-card" data-tutorial-card="${memory.id}">
      <button class="memory-open" data-memory="${memory.id}" aria-label="${escapeHtml(memory.title)} 열기">
        <img src="${escapeHtml(memory.image)}" data-memory-frame="${escapeHtml(memory.id)}" alt="">
        <span class="memory-tint"></span>
        <span class="memory-card-copy"><small>${escapeHtml(memory.date)}</small><strong>${escapeHtml(memory.title)}</strong><em>${escapeHtml(memory.place)} · ${escapeHtml(memory.mood)}</em></span>
      </button>
      ${caregiver ? `<button class="card-delete" data-delete-memory="${memory.id}" aria-label="${escapeHtml(memory.title)} 삭제" title="영상 삭제">${icon("trash", 16)}</button>` : ""}
      <button class="card-heart ${memory.favorite ? "on" : ""}" data-favorite="${memory.id}" aria-label="즐겨찾기">${icon("heart", 18)}</button>
    </article>`;
}

function memoryDetail(caregiver) {
  const memory = currentMemory();
  return `
    <main class="memory-detail">
      <img src="${escapeHtml(memory.image)}" data-memory-frame="${escapeHtml(memory.id)}" alt="${escapeHtml(memory.title)}">
      <div class="detail-shade"></div>
      <button class="detail-back" data-detail-close aria-label="뒤로">${icon("back", 22)}</button>
      ${caregiver ? `<button class="detail-delete" data-delete-memory="${memory.id}" aria-label="영상 삭제" title="영상 삭제">${icon("trash", 19)}</button>` : ""}
      <button class="detail-heart ${memory.favorite ? "on" : ""}" data-favorite="${memory.id}" aria-label="즐겨찾기">${icon("heart", 21)}</button>
      <button class="detail-play" data-play="${memory.id}" aria-label="재생">${icon(state.playing ? "pause" : "play", 30)}</button>
      <div class="detail-copy"><small>${escapeHtml(memory.date)} · ${escapeHtml(memory.place)}</small><h1>${escapeHtml(memory.title)}</h1><p>${escapeHtml(memory.script)}</p>${caregiver ? `<span class="reaction-badge">긍정 반응 ${state.device.reactions}회</span>` : ""}</div>
    </main>`;
}

function renderCaregiverContent() {
  if (state.tab === "memory") return memoryVault(true);
  if (state.tab === "profile") return caregiverProfile();
  if (state.tab === "device") return deviceView();
  return dashboardView();
}

function caregiverHeader() {
  return `
    <header class="care-header">
      <div class="care-brand"><span>B</span><div><strong>북마크 케어</strong><small>${escapeHtml(state.patient.name)}님의 보호자 앱</small></div></div>
      <button class="icon-button" data-tab="profile" aria-label="환자 프로필">${icon("user")}</button>
    </header>`;
}

function dashboardView() {
  const memory = currentMemory();
  return `
    ${caregiverHeader()}
    <main class="page care-home">
      <div class="welcome"><div><p>안녕하세요, ${escapeHtml(state.patient.guardian)}님</p><h1>${escapeHtml(state.patient.name)}님의 오늘</h1></div><span class="online-dot">안정</span></div>
      <section class="mood-section">
        <div class="section-heading"><div><small>오늘의 정서 상태</small><strong>평온하게 지내고 있어요</strong></div><span>실시간</span></div>
        <div class="mood-chart">${chartSvg()}</div>
        <div class="chart-labels"><span>오전 8시</span><span>오후 12시</span><span>오후 4시</span></div>
      </section>
      <button class="today-memory" data-tab="memory">
        <span class="today-icon">${icon("heart", 18)}</span>
        <span><small>오늘 발견한 좋은 순간</small><strong>${escapeHtml(memory.title)}</strong><em>${escapeHtml(memory.mood)}</em></span>
        ${icon("chevron", 20)}
      </button>
      <div class="metric-grid">
        <button class="metric-card dark" data-tab="device"><span>${icon("wifi", 18)}</span><strong>${state.device.battery}%</strong><small>목걸이 배터리</small></button>
        <button class="metric-card gray" data-tab="memory"><span>${icon("heart", 18)}</span><strong>${state.device.reactions}회</strong><small>오늘 긍정 반응</small></button>
      </div>
      <section class="care-note"><span>${icon("bell", 18)}</span><div><strong>오후 3시에 추억을 재생해보세요</strong><p>평소 불안감이 높아지는 시간이에요.</p></div></section>
    </main>`;
}

function caregiverProfile() {
  const patient = state.patient;
  return `
    ${appHeader("사용자 프로필")}
    <main class="page profile-page">
      <label class="search-box">${icon("search", 17)}<input value="${escapeHtml(patient.name)}" readonly aria-label="연결된 사용자"></label>
      <div class="profile-filters"><button class="${state.profileFilter === "mine" ? "active" : ""}" data-profile-filter="mine">내 환자</button><button class="${state.profileFilter === "recent" ? "active" : ""}" data-profile-filter="recent">최근 연결</button></div>
      <section class="patient-profile-card">
        <div class="profile-avatar">${escapeHtml(patient.name.slice(0, 1))}</div>
        <span class="diagnosis-chip">${escapeHtml(patient.diagnosis)}</span>
        <h2>${escapeHtml(patient.name)}님</h2>
        <dl>
          <div><dt>생년월일</dt><dd>${formatDate(patient.birthDate)}</dd></div>
          <div><dt>보호자</dt><dd>${escapeHtml(patient.guardian)} · ${escapeHtml(patient.relation)}</dd></div>
          <div><dt>연락처</dt><dd>${escapeHtml(patient.guardianPhone)}</dd></div>
          <div><dt>등록일</dt><dd>${formatDate(patient.registeredAt)}</dd></div>
        </dl>
        <button class="outline-button" data-modal="edit">${icon("edit", 17)} 정보 수정</button>
      </section>
      <section class="profile-note"><small>돌봄 메모</small><p>${escapeHtml(patient.note || "등록된 돌봄 메모가 없습니다.")}</p></section>
    </main>`;
}

function deviceView() {
  return `
    ${appHeader("기기 상태")}
    <main class="page device-page">
      <section class="necklace-status">
        <span class="necklace-icon">B</span>
        <div><small>BOOKMARK NECKLACE</small><h2>환자 앱에서 연결</h2><p>카메라와 SoftAP 연결은 환자 휴대폰에서 진행합니다.</p></div>
      </section>
      <div class="device-list">
        <div><span>배터리</span><strong>${state.device.battery}%</strong></div>
        <div><span>기기 온도</span><strong>${state.device.temperature}°C</strong></div>
        <div><span>최근 기록 수신</span><em class="status ${state.device.wifi ? "on" : ""}">${state.device.wifi ? "완료" : "환자 앱 대기"}</em></div>
      </div>
      <button class="logout-button" data-logout>${icon("log", 17)} 로그아웃</button>
    </main>`;
}

function modalView() {
  if (state.modal === "live") {
    const ai = liveAiView();
    const streaming = state.liveMode === "stream";
    const previewUrl = state.liveAnalysis?.previewUrl || "";
    const statusLabel = state.analysisRunning
      ? "AI 분석"
      : state.liveMode === "result"
        ? "판정 완료"
        : streaming
          ? "연결 중"
          : "영상 처리";
    const emptyTitle = state.analysisRunning
      ? "Gemini 분석 중"
      : state.pendingCapture
        ? "영상 수신 완료"
        : state.liveMode === "receiving"
          ? "최근 장면 수신 중"
          : "카메라 연결 중";
    const emptyCopy = state.analysisRunning
      ? "실제 장면의 추억 가치와 안전 여부를 판별하고 있어요."
      : state.pendingCapture
        ? "일반 Wi-Fi로 돌아오면 분석이 자동으로 이어집니다."
        : "Bookmark_Necklace Wi-Fi를 확인해주세요.";
    return `
      <section class="live-camera-modal" aria-label="실시간 카메라">
        <header>
          <button class="live-close" data-live-close aria-label="실시간 화면 닫기">${icon("back", 23)}</button>
          <div><small>BOOKMARK NECKLACE</small><h2>실시간 카메라</h2></div>
          <span class="live-camera-status ${streaming ? "" : "on"}" id="liveCameraStatus"><i></i><b>${statusLabel}</b></span>
        </header>
        <div class="live-camera-stage">
          <img id="liveCameraFrame" ${previewUrl ? `src="${escapeHtml(previewUrl)}" class="ready"` : ""} alt="목걸이 카메라 실시간 화면">
          <div class="live-camera-empty ${previewUrl ? "hidden" : ""}" id="liveCameraEmpty">
            <span>${state.analysisRunning ? "AI" : icon("camera", 32)}</span>
            <strong>${emptyTitle}</strong>
            <p>${emptyCopy}</p>
          </div>
          <span class="live-badge ${streaming ? "" : "ai"}"><i></i> ${streaming ? "LIVE" : "AI"}</span>
          <div class="live-ai-panel ${ai.tone}" id="liveAiPanel">
            <span class="live-ai-mark">AI</span>
            <div><small>${streaming ? "최근 GEMINI 판단" : "GEMINI SCENE CURATOR"}</small><strong id="liveAiTitle">${escapeHtml(ai.title)}</strong><p id="liveAiDetail">${escapeHtml(ai.detail)}</p></div>
            <em id="liveAiBadge">${escapeHtml(ai.badge)}</em>
          </div>
          <div class="live-analysis-pipeline">${analysisPipelineMarkup(true)}</div>
        </div>
        <footer>
          <div><strong>${streaming ? "목걸이 카메라" : "AI 장면 판별"}</strong><span>${streaming ? "이 화면에는 가장 최근 Gemini 판정 결과만 표시됩니다." : "판정 단계와 근거를 위 화면에서 확인하세요."}</span></div>
          <div class="live-footer-actions">
            ${state.pendingCapture && !state.analysisRunning
              ? `<button class="live-retry-button" data-analyze-pending>${icon("rotate", 17)}<span>Gemini 분석 다시 시도</span></button>`
              : `<button class="live-video-button" data-sync ${state.analysisRunning || necklaceSyncInProgress ? "disabled" : ""}>${icon("image", 17)}<span>최근 30초 분석</span></button>
                 <button class="live-photo-button" data-esp-snapshot ${state.analysisRunning || necklaceSyncInProgress ? "disabled" : ""}>${icon("camera", 17)}<span>ESP 한 장 분석</span></button>`}
            ${state.liveMode === "result"
                ? `<button class="live-resume-button" data-live-resume aria-label="실시간 카메라로 돌아가기" title="실시간 보기">${icon("camera", 20)}</button>`
                : `<span class="live-analysis-estimate"><small>예상 분석</small><b>10~30초</b></span>`}
          </div>
        </footer>
      </section>`;
  }
  if (state.modal === "add") return `
    <div class="modal-backdrop"><section class="sheet">
      <header><div><small>NEW MEMORY</small><h2>추억 직접 추가</h2></div><button class="icon-button" data-modal-close aria-label="닫기">${icon("close")}</button></header>
      <form class="form-stack" id="memoryForm">
        <label>추억 제목<input name="title" required placeholder="가족과 함께한 산책"></label>
        <div class="field-pair"><label>날짜<input name="date" type="date" required value="2026-07-13"></label><label>장소<input name="place" required placeholder="집 근처 공원"></label></div>
        <label>장면 유형<select name="type"><option value="party">가족 모임</option><option value="stage">음악·공연</option><option value="calm">평온한 일상</option></select></label>
        <label>기억 설명<textarea name="script" required placeholder="환자에게 들려줄 따뜻한 설명을 적어주세요."></textarea></label>
        <button class="primary-button" type="submit">보관함에 저장</button>
      </form>
    </section></div>`;
  if (state.modal === "edit") return `
    <div class="modal-backdrop"><section class="sheet">
      <header><div><small>PATIENT PROFILE</small><h2>환자 정보 수정</h2></div><button class="icon-button" data-modal-close aria-label="닫기">${icon("close")}</button></header>
      <form class="form-stack" id="profileForm">
        <label>이름<input name="name" required value="${escapeHtml(state.patient.name)}"></label>
        <div class="field-pair"><label>생년월일<input name="birthDate" type="date" required value="${escapeHtml(state.patient.birthDate)}"></label><label>진단 단계<select name="diagnosis">${["경증 치매", "중등도 치매", "중증 치매"].map((item) => `<option ${item === state.patient.diagnosis ? "selected" : ""}>${item}</option>`).join("")}</select></label></div>
        <label>보호자 연락처<input name="guardianPhone" required value="${escapeHtml(state.patient.guardianPhone)}"></label>
        <label>돌봄 메모<textarea name="note">${escapeHtml(state.patient.note)}</textarea></label>
        <button class="primary-button" type="submit">수정 내용 저장</button>
      </form>
    </section></div>`;
  return "";
}

function currentMemory() {
  return state.patient?.memories.find((memory) => memory.id === state.selectedMemoryId) || state.patient?.memories[0] || demoMemories[0];
}

function formatDate(value) {
  if (!value) return "-";
  const parts = value.replaceAll(".", "-").split("-");
  return `${parts[0]}년 ${parts[1] || "01"}월 ${parts[2] || "01"}일`;
}

function chartSvg() {
  return `<svg viewBox="0 0 300 105" preserveAspectRatio="none" aria-label="정서 상태 그래프"><path class="grid" d="M0 24H300M0 52H300M0 80H300"/><path class="area" d="M0 68 C24 61 35 44 58 51 S92 72 112 59 S140 28 161 43 S193 74 214 57 S244 31 265 47 S285 58 300 43 V105H0Z"/><path class="line" d="M0 68 C24 61 35 44 58 51 S92 72 112 59 S140 28 161 43 S193 74 214 57 S244 31 265 47 S285 58 300 43"/><circle cx="265" cy="47" r="5"/></svg>`;
}

function bind() {
  document.querySelectorAll("[data-auth]").forEach((element) => element.addEventListener("click", () => { state.authMode = element.dataset.auth; render(); }));
  document.querySelectorAll("[data-tab]").forEach((element) => element.addEventListener("click", () => {
    state.tab = element.dataset.tab;
    state.modal = null;
    state.search = "";
    render();
  }));
  document.querySelectorAll("[data-memory]").forEach((element) => element.addEventListener("click", () => openMemory(element.dataset.memory)));
  document.querySelectorAll("[data-favorite]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(element.dataset.favorite);
  }));
  document.querySelectorAll("[data-delete-memory]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation();
    deleteMemory(element.dataset.deleteMemory);
  }));
  document.querySelectorAll("[data-play]").forEach((element) => element.addEventListener("click", () => playCurrent(element.dataset.play)));
  document.querySelectorAll("[data-filter-favorite]").forEach((element) => element.addEventListener("click", () => { state.favoriteOnly = !state.favoriteOnly; render(); }));
  document.querySelectorAll("[data-profile-filter]").forEach((element) => element.addEventListener("click", () => { state.profileFilter = element.dataset.profileFilter; render(); }));
  document.querySelectorAll("[data-modal]").forEach((element) => element.addEventListener("click", () => { state.modal = element.dataset.modal; render(); }));
  document.querySelectorAll("[data-modal-close]").forEach((element) => element.addEventListener("click", () => { state.modal = null; render(); }));
  document.querySelectorAll("[data-detail-close]").forEach((element) => element.addEventListener("click", () => { state.modal = null; render(); }));
  document.querySelectorAll("[data-sync]").forEach((element) => element.addEventListener("click", syncNecklace));
  document.querySelectorAll("[data-analyze-pending]").forEach((element) => element.addEventListener("click", analyzePendingCapture));
  document.querySelectorAll("[data-live-open]").forEach((element) => element.addEventListener("click", openLivePreview));
  document.querySelectorAll("[data-live-close]").forEach((element) => element.addEventListener("click", () => { state.modal = null; render(); }));
  document.querySelectorAll("[data-live-refresh]").forEach((element) => element.addEventListener("click", startLivePreview));
  document.querySelectorAll("[data-live-resume]").forEach((element) => element.addEventListener("click", resumeLivePreview));
  document.querySelectorAll("[data-ble]").forEach((element) => element.addEventListener("click", connectBle));
  document.querySelectorAll("[data-softap-connect]").forEach((element) => element.addEventListener("click", connectBookmarkWifi));
  document.querySelectorAll("[data-softap-check]").forEach((element) => element.addEventListener("click", checkSoftAp));
  document.querySelectorAll("[data-copy-password]").forEach((element) => element.addEventListener("click", copyWifiPassword));
  document.querySelectorAll("[data-open-wifi-settings]").forEach((element) => element.addEventListener("click", openWifiSettings));
  document.querySelectorAll("[data-esp-snapshot]").forEach((element) => element.addEventListener("click", analyzeEspSnapshot));
  document.querySelectorAll("[data-logout]").forEach((element) => element.addEventListener("click", logout));
  document.querySelectorAll("[data-tutorial-start]").forEach((element) => element.addEventListener("click", startFeedTutorial));
  document.querySelectorAll("[data-tutorial-finish]").forEach((element) => element.addEventListener("click", finishTutorial));

  const search = document.getElementById("memorySearch");
  if (search) search.addEventListener("input", (event) => {
    state.search = event.target.value;
    const caret = event.target.selectionStart;
    render();
    const next = document.getElementById("memorySearch");
    next?.focus();
    next?.setSelectionRange(caret, caret);
  });
  document.getElementById("patientForm")?.addEventListener("submit", onPatientRegister);
  document.getElementById("patientLoginForm")?.addEventListener("submit", onPatientLogin);
  document.getElementById("caregiverForm")?.addEventListener("submit", onCaregiverLogin);
  document.getElementById("memoryForm")?.addEventListener("submit", onMemoryAdd);
  document.getElementById("profileForm")?.addEventListener("submit", onProfileEdit);
  document.getElementById("wifiReturnForm")?.addEventListener("submit", saveWifiReturnSettings);

  const feed = document.getElementById("videoFeed");
  if (feed) feed.addEventListener("scroll", () => {
    if (state.tutorialStep === "feed" && feed.scrollTop >= feed.clientHeight * 0.55) {
      finishTutorial();
      return;
    }
    clearTimeout(window.feedTimer);
    window.feedTimer = setTimeout(() => {
      const slides = [...feed.querySelectorAll("[data-feed-id]")];
      const closest = slides.sort((a, b) => Math.abs(a.offsetTop - feed.scrollTop) - Math.abs(b.offsetTop - feed.scrollTop))[0];
      if (closest) state.selectedMemoryId = closest.dataset.feedId;
    }, 100);
  });
}

async function onPatientRegister(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  const email = data.email.trim().toLowerCase();
  const patient = savePatient({
    email,
    name: data.name.trim(),
    birthDate: data.birthDate,
    diagnosis: data.diagnosis,
    guardian: data.guardian.trim(),
    relation: data.relation.trim(),
    guardianPhone: data.guardianPhone.trim(),
    registeredAt: new Date().toISOString().slice(0, 10),
    note: data.note.trim(),
    memories: cloneMemories()
  }, false);
  await syncPatientToServer(patient);
  setSession("patient", email, patient);
  toast("환자 프로필이 등록되었습니다.");
}

async function onPatientLogin(event) {
  event.preventDefault();
  const email = new FormData(event.currentTarget).get("email").trim().toLowerCase();
  const patient = await fetchPatientFromServer(email) || getPatient(email);
  if (!patient) return toast("등록된 환자 이메일을 찾지 못했습니다.");
  setSession("patient", email, patient);
}

async function onCaregiverLogin(event) {
  event.preventDefault();
  const email = new FormData(event.currentTarget).get("email").trim().toLowerCase();
  const patient = await fetchPatientFromServer(email) || getPatient(email);
  if (!patient) return toast("환자 프로필이 없습니다. 환자 앱에서 먼저 가입해주세요.");
  setSession("caregiver", email, patient);
  toast(`${patient.name}님의 프로필에 연결되었습니다.`);
}

function onMemoryAdd(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  const memory = {
    id: `memory-${Date.now()}`,
    title: data.title.trim(),
    date: data.date.replaceAll("-", "."),
    place: data.place.trim(),
    mood: "보호자 확인 필요",
    type: data.type,
    favorite: false,
    image: data.type === "stage" ? "assets/community-stage.png" : "assets/family-birthday.png",
    script: data.script.trim()
  };
  state.patient.memories = [memory, ...state.patient.memories];
  state.patient = savePatient(state.patient);
  state.selectedMemoryId = memory.id;
  state.modal = null;
  render();
  toast("새 추억을 보관함에 저장했습니다.");
}

function onProfileEdit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  Object.assign(state.patient, {
    name: data.name.trim(),
    birthDate: data.birthDate,
    diagnosis: data.diagnosis,
    guardianPhone: data.guardianPhone.trim(),
    note: data.note.trim()
  });
  state.patient = savePatient(state.patient);
  state.modal = null;
  render();
  toast("환자 정보를 수정했습니다.");
}

function openMemory(id) {
  state.selectedMemoryId = id;
  if (state.role === "patient") {
    state.tab = "home";
  } else {
    state.modal = "detail";
  }
  render();
}

function toggleFavorite(id) {
  const memory = state.patient.memories.find((item) => item.id === id);
  if (!memory) return;
  memory.favorite = !memory.favorite;
  state.patient = savePatient(state.patient);
  render();
  toast(memory.favorite ? "즐겨찾기에 저장했습니다." : "즐겨찾기에서 제외했습니다.");
}

async function deleteMemory(id) {
  if (state.role !== "caregiver") return;
  const memory = state.patient.memories.find((item) => item.id === id);
  if (!memory) return;
  if (!window.confirm(`'${memory.title}' 영상을 삭제할까요?\n삭제한 영상은 복구할 수 없습니다.`)) return;

  stopMemoryPlaybackMedia();
  try {
    const response = await fetch(
      `/api/patients/${encodeURIComponent(state.email)}/memories/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "memory_delete_failed");

    state.patient = savePatient(result.patient, false);
    state.selectedMemoryId = state.patient.memories[0]?.id || null;
    state.modal = null;
    state.playing = false;
    render();
    toast("영상과 저장된 파일을 삭제했습니다.");
  } catch (error) {
    console.error("Memory deletion failed:", error);
    toast("영상을 삭제하지 못했습니다. 서버 연결을 확인해주세요.");
  }
}

function playCurrent(id) {
  const switchingMemory = Boolean(id && id !== state.selectedMemoryId);
  if (id) state.selectedMemoryId = id;
  state.playing = switchingMemory ? true : !state.playing;
  render();
  toast(state.playing ? `${currentMemory().title} 재생 중` : "재생을 멈췄습니다.");
}

function stopMemoryPlaybackMedia() {
  clearInterval(memoryPlaybackTimer);
  memoryPlaybackTimer = null;
  if (memoryPlaybackAudio) {
    memoryPlaybackAudio.pause();
    memoryPlaybackAudio = null;
  }
}

function startMemoryPlayback(memory) {
  if (!memory) return;
  const frames = Array.isArray(memory.frames) && memory.frames.length ? memory.frames : [memory.image];
  const images = [...document.querySelectorAll("[data-memory-frame]")]
    .filter((image) => image.dataset.memoryFrame === memory.id);
  let frameIndex = 0;

  if (frames.length > 1 && images.length) {
    memoryPlaybackTimer = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      images.forEach((image) => { image.src = frames[frameIndex]; });
    }, Math.min(1000, Math.max(120, Number(memory.frameIntervalMs) || 480)));
  }

  const audioSource = memory.audio || (memory.id.startsWith("import-") ? state.audioUrl : null);
  if (audioSource) {
    memoryPlaybackAudio = new Audio(audioSource);
    memoryPlaybackAudio.play().catch(() => {});
  }
}

function startFeedTutorial() {
  state.tab = "home";
  state.modal = null;
  state.tutorialStep = "feed";
  render();
}

function finishTutorial() {
  state.tutorialStep = null;
  state.modal = null;
  localStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
  render();
}

async function probeSoftAp(timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${DEVICE_BASE}/status`, {
      cache: "no-store",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function checkSoftAp() {
  if (state.role !== "patient") return;
  toast("목걸이 Wi-Fi 연결을 확인하고 있습니다.");
  state.device.softap = await probeSoftAp();
  if (state.device.softap) stopSoftApConnectionWatcher();
  render();
  toast(state.device.softap
    ? "카메라가 연결되었습니다. 기록을 가져올 수 있어요."
    : `휴대폰 Wi-Fi에서 ${NECKLACE_WIFI_SSID}를 먼저 선택해주세요.`);
}

async function connectBookmarkWifi() {
  if (state.role !== "patient" || state.device.softapConnecting) return;
  if (state.device.softap) return checkSoftAp();

  state.device.softapConnecting = true;
  render();
  toast(`${NECKLACE_WIFI_SSID} 연결을 준비하고 있습니다.`);
  startSoftApConnectionWatcher();

  const nativeBridge = globalThis.BookmarkNative;
  if (nativeBridge && typeof nativeBridge.connectWifi === "function") {
    try {
      await Promise.resolve(nativeBridge.connectWifi(NECKLACE_WIFI_SSID, NECKLACE_WIFI_PASSWORD));
      return;
    } catch {
      // Fall through to the operating system Wi-Fi screen.
    }
  }

  void writeWifiPasswordToClipboard();
  toast(`비밀번호 ${NECKLACE_WIFI_PASSWORD}을 복사했습니다. ${NECKLACE_WIFI_SSID}를 선택해주세요.`);
  openWifiSettings();
}

function startSoftApConnectionWatcher() {
  clearTimeout(softApConnectTimer);
  state.device.softapConnecting = true;
  const deadline = Date.now() + 90_000;

  const poll = async () => {
    if (!state.device.softapConnecting || state.role !== "patient") return;
    const connected = await probeSoftAp(2200);
    if (connected) {
      state.device.softap = true;
      stopSoftApConnectionWatcher();
      render();
      toast(`${NECKLACE_WIFI_SSID}에 연결되었습니다.`);
      return;
    }
    if (Date.now() >= deadline) {
      stopSoftApConnectionWatcher();
      render();
      toast(`${NECKLACE_WIFI_SSID} 연결을 확인하지 못했습니다.`);
      return;
    }
    softApConnectTimer = setTimeout(poll, 1200);
  };

  softApConnectTimer = setTimeout(poll, 500);
}

function stopSoftApConnectionWatcher() {
  clearTimeout(softApConnectTimer);
  softApConnectTimer = null;
  state.device.softapConnecting = false;
}

function openLivePreview() {
  if (state.role !== "patient") return;
  state.modal = "live";
  state.liveMode = "stream";
  state.liveAnalysis = null;
  render();
  startLivePreview();
}

function resumeLivePreview() {
  state.liveMode = "stream";
  state.liveAnalysis = null;
  render();
  startLivePreview();
}

function startLivePreview() {
  if (state.liveMode !== "stream") return;
  stopLivePreview();
  const generation = livePreviewGeneration;
  livePreviewFailureCount = 0;
  updateLivePreviewStatus("연결 중", false);
  const frame = document.getElementById("liveCameraFrame");
  const empty = document.getElementById("liveCameraEmpty");
  if (!frame) return;

  frame.classList.remove("ready");
  empty?.classList.remove("hidden");
  frame.onload = () => handleLivePreviewFrame(generation);
  frame.onerror = () => handleLivePreviewFrameError(generation);
  loadLivePreviewFrame(generation);
}

function stopLivePreview() {
  livePreviewGeneration += 1;
  clearTimeout(livePreviewTimer);
  livePreviewTimer = null;
  const frame = document.getElementById("liveCameraFrame");
  if (frame) {
    frame.onload = null;
    frame.onerror = null;
    frame.removeAttribute("src");
  }
}

function loadLivePreviewFrame(generation) {
  if (generation !== livePreviewGeneration || state.modal !== "live") return;
  const frame = document.getElementById("liveCameraFrame");
  if (!frame) return;
  frame.src = `${DEVICE_BASE}/live?t=${Date.now()}`;
}

function handleLivePreviewFrame(generation) {
  if (generation !== livePreviewGeneration || state.modal !== "live") return;
  livePreviewFailureCount = 0;
  const frame = document.getElementById("liveCameraFrame");
  if (!frame?.classList.contains("ready")) markLiveStreamReady(generation);
  clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(() => loadLivePreviewFrame(generation), LIVE_PREVIEW_INTERVAL_MS);
}

function handleLivePreviewFrameError(generation) {
  if (generation !== livePreviewGeneration || state.modal !== "live") return;
  livePreviewFailureCount += 1;
  if (livePreviewFailureCount < 3) {
    clearTimeout(livePreviewTimer);
    livePreviewTimer = setTimeout(() => loadLivePreviewFrame(generation), 350);
    return;
  }
  handleLiveStreamError(generation);
}

function markLiveStreamReady(generation) {
  if (generation !== livePreviewGeneration || state.modal !== "live") return;
  clearTimeout(livePreviewTimer);
  const frame = document.getElementById("liveCameraFrame");
  frame?.classList.add("ready");
  document.getElementById("liveCameraEmpty")?.classList.add("hidden");
  state.device.softap = true;
  updateLivePreviewStatus("실시간", true);
}

function handleLiveStreamError(generation) {
  if (generation !== livePreviewGeneration || state.modal !== "live") return;
  clearTimeout(livePreviewTimer);
  state.device.softap = false;
  updateLivePreviewStatus("연결 확인", false);
  const empty = document.getElementById("liveCameraEmpty");
  if (empty) {
    empty.classList.remove("hidden");
    empty.querySelector("strong").textContent = "카메라를 찾을 수 없어요";
    empty.querySelector("p").textContent = "휴대폰 Wi-Fi에서 Bookmark_Necklace를 선택해주세요.";
  }
  livePreviewTimer = setTimeout(startLivePreview, 1600);
}

function updateLivePreviewStatus(label, connected) {
  const status = document.getElementById("liveCameraStatus");
  if (!status) return;
  status.classList.toggle("on", connected);
  const text = status.querySelector("b");
  if (text) text.textContent = label;
}

async function copyWifiPassword() {
  await writeWifiPasswordToClipboard();
  toast("Wi-Fi 비밀번호를 복사했습니다.");
}

async function writeWifiPasswordToClipboard() {
  const password = NECKLACE_WIFI_PASSWORD;
  try {
    if (!navigator.clipboard) throw new Error("clipboard_unavailable");
    await navigator.clipboard.writeText(password);
  } catch {
    const input = document.createElement("input");
    input.value = password;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}

function saveWifiReturnSettings(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const ssid = String(data.get("ssid") || "").trim().slice(0, 64);
  store.wifiReturn = { enabled: true, ssid };
  render();
  toast(`${ssid || "저장된 기본 Wi-Fi"}를 자동 복귀 대상으로 저장했습니다.`);
}

function openWifiSettings() {
  const userAgent = navigator.userAgent || "";
  if (/Android/i.test(userAgent)) {
    window.location.href = "intent:#Intent;action=android.settings.WIFI_SETTINGS;end";
    return;
  }
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    window.location.href = "App-Prefs:root=WIFI";
    return;
  }
  toast("휴대폰의 설정에서 Wi-Fi 메뉴를 열어주세요.");
}

async function analyzeEspSnapshot() {
  if (state.analysisRunning || necklaceSyncInProgress) return;
  if (state.pendingCapture) {
    toast("먼저 대기 중인 영상 분석을 완료해주세요.");
    return;
  }

  stopLivePreview();
  necklaceSyncInProgress = true;
  state.liveMode = "receiving";
  render();
  toast("ESP 카메라의 최신 화면 한 장을 가져오고 있습니다.");
  try {
    await new Promise((resolve) => setTimeout(resolve, 450));
    const jpegBuffer = await fetchEspSnapshot();
    const jpegBlob = new Blob([jpegBuffer], { type: "image/jpeg" });
    const frame = { mimeType: "image/jpeg", data: bytesToBase64(jpegBuffer) };
    state.frameUrls.forEach(URL.revokeObjectURL);
    state.frameUrls = [URL.createObjectURL(jpegBlob)];
    state.pendingCapture = {
      patientEmail: state.email,
      captureId: createCaptureId(),
      capturedAt: new Date().toISOString(),
      flowVersion: MANUAL_CAPTURE_FLOW_VERSION,
      initiatedBy: "manual",
      frames: [frame],
      videoFrames: [frame],
      durationMs: 1000,
      audio: null,
      source: "esp-snapshot"
    };
    await persistPendingCapture(state.pendingCapture);
    await completeEspCaptureAndAnalyze("ESP 사진 한 장");
  } catch (error) {
    console.error("ESP snapshot analysis preparation failed:", error);
    state.device.softap = false;
    toast("ESP 사진을 받지 못했습니다. Bookmark_Necklace 연결을 확인해주세요.");
    if (state.modal === "live") {
      state.liveMode = "stream";
      render();
      startLivePreview();
    }
  } finally {
    necklaceSyncInProgress = false;
  }
}

async function fetchEspSnapshot(maxAttempts = 3) {
  let lastError = new Error("snapshot_unavailable");
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(`${DEVICE_BASE}/live?t=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`snapshot_http_${response.status}`);
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
        throw new Error("snapshot_invalid_jpeg");
      }
      return buffer;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function connectBle() {
  if (state.role !== "patient") return;
  if (!navigator.bluetooth) return toast("이 브라우저에서는 BLE를 지원하지 않습니다. 시연은 계속할 수 있어요.");
  try {
    if (bleDevice?.gatt?.connected && bleCharacteristic) {
      await bleCharacteristic.writeValue(new TextEncoder().encode(`TIME:${new Date().toISOString()}`));
      return toast("Bluetooth 상태 연결과 시간 동기화가 정상입니다.");
    }

    bleDevice = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE_SERVICE] }] });
    bleDevice.addEventListener("gattserverdisconnected", handleBleDisconnected);
    const server = await bleDevice.gatt.connect();
    const service = await server.getPrimaryService(BLE_SERVICE);
    bleCharacteristic = await service.getCharacteristic(BLE_CHAR);
    await bleCharacteristic.startNotifications();
    bleCharacteristic.addEventListener("characteristicvaluechanged", handleBleTelemetry);
    await bleCharacteristic.writeValue(new TextEncoder().encode(`TIME:${new Date().toISOString()}`));
    state.device.ble = true;
    render();
    toast("Bluetooth 상태 알림과 시간이 연결되었습니다.");
  } catch {
    state.device.ble = false;
    toast("BLE 연결이 취소되었거나 실패했습니다.");
  }
}

function handleBleTelemetry(event) {
  try {
    const value = event.target.value;
    const text = new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    const payload = JSON.parse(text);
    if (payload.type !== "status") return;

    state.device.ble = true;
    if (Number.isFinite(Number(payload.battery))) state.device.battery = Number(payload.battery);
    if (Number.isFinite(Number(payload.temperature))) state.device.temperature = Number(payload.temperature);
    if (Number.isFinite(Number(payload.tickCountToday))) state.device.reactions = Number(payload.tickCountToday);
    state.device.camera = Boolean(payload.camera);
    state.device.microphone = Boolean(payload.microphone);
  } catch {
    // Ignore incomplete BLE packets and wait for the next 3-second status update.
  }
}

function handleBleDisconnected() {
  state.device.ble = false;
  bleCharacteristic = null;
  if (state.route === "app" && state.modal !== "live") render();
  toast("목걸이 Bluetooth 연결이 끊어졌습니다.");
}

async function syncNecklace() {
  if (state.role !== "patient") return toast("목걸이 연결은 환자 앱에서 진행해주세요.");
  if (necklaceSyncInProgress || state.analysisRunning) return;
  necklaceSyncInProgress = true;
  let transferTimer = null;
  if (!state.device.softap) {
    state.device.softap = await probeSoftAp();
    if (!state.device.softap) {
      necklaceSyncInProgress = false;
      render();
      toast("휴대폰 Wi-Fi에서 Bookmark_Necklace를 먼저 선택해주세요.");
      return;
    }
  }
  stopLivePreview();
  if (state.modal === "live") {
    state.liveMode = "receiving";
    render();
  }
  toast("목걸이의 최근 30초 기록을 가져오는 중입니다.");
  try {
    const transferController = new AbortController();
    transferTimer = setTimeout(() => transferController.abort(), 45_000);
    const [audio, video] = await Promise.allSettled([
      fetch(`${DEVICE_BASE}/audio`, { signal: transferController.signal }).then((response) => { if (!response.ok) throw new Error("audio"); return response.arrayBuffer(); }),
      fetch(`${DEVICE_BASE}/video`, { signal: transferController.signal }).then(async (response) => {
        if (!response.ok) throw new Error("video");
        return {
          buffer: await response.arrayBuffer(),
          durationMs: Number(response.headers.get("X-Bookmark-Duration-Ms")) || 0
        };
      })
    ]);
    let wav = null;
    if (audio.status === "fulfilled") {
      wav = pcm16ToWav(audio.value, 16000);
      if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
      state.audioUrl = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    }
    if (video.status !== "fulfilled") throw new Error("video_unavailable");

    const allFrames = parseJpegFrames(video.value.buffer);
    const sampledFrames = sampleJpegFrames(allFrames, 8);
    const playbackFrames = sampleJpegFrames(allFrames, 96);
    if (!sampledFrames.length) throw new Error("video_empty");
    state.frameUrls.forEach(URL.revokeObjectURL);
    state.frameUrls = sampledFrames.map((buffer) => URL.createObjectURL(new Blob([buffer], { type: "image/jpeg" })));
    state.pendingCapture = {
      patientEmail: state.email,
      captureId: createCaptureId(),
      capturedAt: new Date().toISOString(),
      flowVersion: MANUAL_CAPTURE_FLOW_VERSION,
      initiatedBy: "manual",
      frames: sampledFrames.map((frame) => ({ mimeType: "image/jpeg", data: bytesToBase64(frame) })),
      videoFrames: playbackFrames.map((frame) => ({ mimeType: "image/jpeg", data: bytesToBase64(frame) })),
      durationMs: Math.max(1000, Math.min(30_000, video.value.durationMs || allFrames.length * 250)),
      audio: wav ? { mimeType: "audio/wav", data: bytesToBase64(wav) } : null
    };
    await persistPendingCapture(state.pendingCapture);
    state.device.softap = true;
    state.device.wifi = true;
    await completeEspCaptureAndAnalyze("최근 30초 영상");
  } catch {
    state.device.softap = false;
    if (!state.pendingCapture) state.device.wifi = false;
    if (state.modal === "live") state.liveMode = "stream";
    toast("목걸이 Wi-Fi(Bookmark_Necklace)에 연결한 뒤 다시 시도해주세요.");
    render();
    if (state.modal === "live") startLivePreview();
  } finally {
    clearTimeout(transferTimer);
    necklaceSyncInProgress = false;
  }
}

async function completeEspCaptureAndAnalyze(captureLabel) {
  const wifiReturn = store.wifiReturn;
  state.device.wifi = true;
  if (state.modal === "live") state.liveMode = "waiting";
  await fetch(`${DEVICE_BASE}/done`, { method: "POST", mode: "no-cors", cache: "no-store" }).catch(() => {});
  if (globalThis.BookmarkNative && typeof globalThis.BookmarkNative.disconnectWifi === "function") {
    globalThis.BookmarkNative.disconnectWifi(NECKLACE_WIFI_SSID);
  }
  state.device.softap = false;
  render();

  const target = wifiReturn.ssid || "저장된 일반 Wi-Fi";
  toast(`${captureLabel} 수신 완료. ${target} 자동 복귀를 기다립니다.`);
  const online = await waitForBookmarkServer(45_000);
  if (!online) {
    toast(`${target}의 자동 연결 설정을 확인해주세요. 연결되면 분석을 재개합니다.`);
    schedulePendingAnalysisRetry(1000);
    return;
  }

  toast("일반 Wi-Fi 연결 확인. Gemini 분석을 시작합니다.");
  await analyzePendingCapture();
}

async function waitForBookmarkServer(timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    try {
      const response = await fetch("/api/gemini/status", {
        cache: "no-store",
        signal: controller.signal
      });
      if (response.ok) return true;
    } catch {
      // The phone is between the ESP SoftAP and its saved internet Wi-Fi.
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return false;
}

async function analyzePendingCapture() {
  const capture = state.pendingCapture;
  if (!capture || state.analysisRunning) return;
  if (capture.patientEmail !== state.email) return toast("현재 환자의 촬영 기록이 아닙니다.");

  state.analysisRunning = true;
  state.liveAnalysis = null;
  if (state.modal === "live") state.liveMode = "analyzing";
  render();
  toast("Gemini가 추억으로 남길 장면인지 분석 중입니다.");

  let timer = null;
  try {
    const status = await fetchGeminiStatus();
    if (!status.configured) {
      const error = new Error("Gemini API 키가 설정되지 않았습니다.");
      error.code = "gemini_key_missing";
      throw error;
    }

    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 55_000);
    const response = await fetch("/api/analyze-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(capture),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.message || "analysis_failed");
      error.code = result.error || "analysis_failed";
      error.httpStatus = response.status;
      throw error;
    }

    state.analysisRunning = false;
    if (result.saved) {
      clearTimeout(pendingAnalysisRetryTimer);
      pendingAnalysisRetryTimer = null;
      state.patient = savePatient(result.patient, false);
      state.selectedMemoryId = result.memory.id;
      state.pendingCapture = null;
      state.device.softap = false;
      state.device.wifi = true;
      saveLastAnalysis({ ...result.analysis, saved: true });
      state.liveAnalysis = {
        ...result.analysis,
        saved: true,
        previewUrl: result.memory.image
      };
      state.playing = false;
      if (state.modal === "live") state.liveMode = "result";
      else state.tab = "memory";
      await removePendingCapture(capture.patientEmail);
      render();
      toast(`AI ${result.analysis.memoryScore}점: 추억 영상으로 저장했습니다.`);
      return;
    }

    const previewIndex = Math.min(
      Math.max(0, Number(result.analysis.representativeFrameIndex) || 0),
      Math.max(0, state.frameUrls.length - 1)
    );
    if (result.patient) state.patient = savePatient(result.patient, false);
    saveLastAnalysis({ ...result.analysis, saved: false });
    clearTimeout(pendingAnalysisRetryTimer);
    pendingAnalysisRetryTimer = null;
    state.liveAnalysis = {
      ...result.analysis,
      saved: false,
      previewUrl: state.frameUrls[previewIndex] || ""
    };
    state.pendingCapture = null;
    state.device.softap = false;
    state.device.wifi = true;
    if (state.modal === "live") state.liveMode = "result";
    await removePendingCapture(capture.patientEmail);
    render();
    toast(`AI ${result.analysis.memoryScore}점: 이번 장면은 저장하지 않았습니다.`);
  } catch (error) {
    state.analysisRunning = false;
    const failureReason = error.code === "gemini_key_missing"
      ? "Gemini API 키 설정을 확인해주세요. 영상은 기기에 보관되어 있습니다."
      : error.httpStatus === 404
        ? "사용 중인 Gemini 모델을 찾을 수 없습니다. 서버 모델 설정을 확인해주세요."
        : "영상은 보관했습니다. 일반 Wi-Fi 연결 후 분석을 다시 시도할 수 있습니다.";
    if (state.modal === "live") {
      state.liveMode = "waiting";
      state.liveAnalysis = {
        saved: false,
        memoryScore: 0,
        eventType: "unclear",
        reason: failureReason
      };
    }
    render();
    if (error.code === "gemini_key_missing") {
      toast("노트북의 .env 파일에 Gemini API 키를 입력해주세요.");
    } else if (error.httpStatus === 401 || error.httpStatus === 403) {
      toast("Gemini API 키 권한을 확인해주세요.");
    } else if (error.httpStatus === 429) {
      toast("Gemini 사용량 한도에 도달했습니다. 잠시 뒤 다시 시도해주세요.");
    } else if (error.httpStatus === 404) {
      toast("Gemini 모델 설정을 확인해주세요. 영상은 보관되어 있습니다.");
    } else if (error.name === "AbortError") {
      toast("분석 시간이 초과되었습니다. 일반 Wi-Fi에서 다시 시도해주세요.");
      schedulePendingAnalysisRetry(1500);
    } else if (error.code === "app_server_unreachable" || !error.httpStatus) {
      toast("영상은 보관했습니다. 일반 Wi-Fi로 돌아온 뒤 분석을 계속해주세요.");
      schedulePendingAnalysisRetry();
    } else if (error.httpStatus >= 500) {
      toast("Gemini 응답이 지연되고 있습니다. 잠시 후 자동으로 다시 시도합니다.");
      schedulePendingAnalysisRetry(3000);
    } else {
      toast(error.message || "Gemini 분석에 실패했습니다. 다시 시도해주세요.");
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGeminiStatus() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch("/api/gemini/status", { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("status_failed");
    return await response.json();
  } catch {
    const error = new Error("Bookmark 서버에 연결하지 못했습니다.");
    error.code = "app_server_unreachable";
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function schedulePendingAnalysisRetry(delay = 3000) {
  clearTimeout(pendingAnalysisRetryTimer);
  pendingAnalysisRetryTimer = null;
  if (!state.pendingCapture || state.role !== "patient" || state.analysisRunning) return;

  pendingAnalysisRetryTimer = setTimeout(async () => {
    pendingAnalysisRetryTimer = null;
    if (!state.pendingCapture || state.role !== "patient" || state.analysisRunning) return;
    try {
      await fetchGeminiStatus();
      await analyzePendingCapture();
    } catch {
      schedulePendingAnalysisRetry();
    }
  }, delay);
}

function createCaptureId() {
  if (globalThis.crypto?.randomUUID) return `capture-${globalThis.crypto.randomUUID()}`;
  return `capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sampleJpegFrames(frames, maximum) {
  if (frames.length <= maximum) return frames;
  const selected = [];
  for (let index = 0; index < maximum; index += 1) {
    const frameIndex = Math.round(index * (frames.length - 1) / (maximum - 1));
    selected.push(frames[frameIndex]);
  }
  return selected;
}

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function openCaptureDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("indexeddb_unavailable"));
      return;
    }
    const request = indexedDB.open("bookmark-pending-captures", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("captures")) {
        request.result.createObjectStore("captures", { keyPath: "patientEmail" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function persistPendingCapture(capture) {
  try {
    const database = await openCaptureDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("captures", "readwrite");
      transaction.objectStore("captures").put(capture);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // The in-memory copy still supports the normal Wi-Fi switch flow.
  }
}

async function readPendingCapture(patientEmail) {
  const database = await openCaptureDatabase();
  const capture = await new Promise((resolve, reject) => {
    const request = database.transaction("captures", "readonly").objectStore("captures").get(patientEmail);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return capture;
}

async function removePendingCapture(patientEmail) {
  try {
    const database = await openCaptureDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("captures", "readwrite");
      transaction.objectStore("captures").delete(patientEmail);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // Nothing else is required when persistent storage is unavailable.
  }
}

async function restorePendingCapture(patientEmail) {
  try {
    const capture = await readPendingCapture(patientEmail);
    if (!capture || state.role !== "patient" || state.email !== patientEmail) return;
    const isCurrentManualFlow = capture.flowVersion === MANUAL_CAPTURE_FLOW_VERSION
      && capture.initiatedBy === "manual";
    if (!isCurrentManualFlow) {
      await removePendingCapture(patientEmail);
      state.pendingCapture = null;
      render();
      return;
    }
    if (!Array.isArray(capture.frames) || !capture.frames.length) return;
    state.pendingCapture = capture;
    render();
    toast("분석을 기다리는 목걸이 영상이 있습니다.");
    schedulePendingAnalysisRetry(500);
  } catch {
    // Pending capture restore is optional on browsers without IndexedDB.
  }
}

function pcm16ToWav(buffer, sampleRate) {
  const dataLength = buffer.byteLength;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);
  const wav = new Uint8Array(44 + dataLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(new Uint8Array(buffer), 44);
  return wav;
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function parseJpegFrames(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const frames = [];
  let offset = 0;
  while (offset + 4 <= bytes.length && frames.length < 320) {
    const length = view.getUint32(offset, true);
    offset += 4;
    if (!length || offset + length > bytes.length) break;
    frames.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  return frames;
}

seed();
const session = store.session;
const initialSession = session;
if (initialSession && getPatient(initialSession.email)) {
  state.role = initialSession.role;
  state.email = initialSession.email;
  state.patient = getPatient(initialSession.email);
  state.lastAnalysis = getStoredLastAnalysis(initialSession.email);
  state.route = "app";
  state.tab = initialSession.role === "caregiver" ? "profile" : "home";
  state.selectedMemoryId = state.patient.memories[0]?.id || null;
  state.tutorialStep = initialSession.role === "patient" && !localStorage.getItem(TUTORIAL_STORAGE_KEY) ? "feed" : null;
}
render();

if (initialSession?.role === "patient") restorePendingCapture(initialSession.email);
if (initialSession) {
  fetchPatientFromServer(initialSession.email).then((patient) => {
    if (!patient || state.email !== initialSession.email) return;
    state.patient = patient;
    render();
  });
}

window.addEventListener("online", () => {
  if (state.role === "patient" && state.patient) {
    if (state.pendingCapture) {
      schedulePendingAnalysisRetry(300);
    } else {
      fetchPatientFromServer(state.email).then((patient) => {
        if (!patient || state.email !== patient.email) return;
        state.patient = patient;
        render();
      });
    }
  }
});

window.addEventListener("bookmark:native-wifi-result", (event) => {
  const result = event.detail || {};
  if (result.success) {
    toast(result.message || `${NECKLACE_WIFI_SSID} 연결 요청을 보냈습니다.`);
    return;
  }
  stopSoftApConnectionWatcher();
  render();
  toast(result.message || `${NECKLACE_WIFI_SSID} 자동 연결에 실패했습니다.`);
});
