# Bookmark

> 치매 환자의 일상에서 다시 볼 가치가 있는 순간을 선별해 회상을 돕는 AI 기억 보조 서비스

Bookmark는 XIAO ESP32-S3 Sense 목걸이가 최근 30초의 영상과 음성을 순환 기록하고, 모바일 앱과 Gemini 분석을 거쳐 의미 있는 장면만 추억 보관함에 저장하는 프로토타입입니다. 환자 화면은 간단한 추억 재생에, 보호자 화면은 기기 연결과 기록 관리에 초점을 맞췄습니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 최근 장면 기록 | ESP32의 PSRAM에 4FPS 영상과 16kHz 음성을 최근 30초 동안 순환 보관 |
| 직접 연결 | SoftAP Wi-Fi로 목걸이와 스마트폰 사이의 영상·음성 전송 |
| AI 추억 선별 | Gemini가 상호작용, 기억 단서, 특별한 사건과 안전 요소를 분석 |
| 서버 검증 | 점수, 신뢰도, 기억 근거, 반복 일상 및 안전 조건으로 최종 저장 여부 결정 |
| 역할별 앱 | 환자용 추억 피드와 보호자용 프로필·추억 관리 화면 제공 |
| 장애 복구 | 촬영 ID 기반 중복 방지, 분석 재시도 및 수신 데이터 복구 |

## 기술 구조

```text
XIAO ESP32-S3 Sense
  -> Wi-Fi SoftAP
Mobile Web App
  -> Node.js Server
Gemini API
  -> Server-side Selection Rules
Memory Feed
```

## 기술 스택

- Hardware: XIAO ESP32-S3 Sense, Arduino, PlatformIO, ESP32 Camera, I2S, Wi-Fi SoftAP, BLE
- Software: HTML, CSS, JavaScript, Node.js
- AI: Gemini multimodal API, JSON Schema 기반 응답 검증
- iOS prototype: SwiftUI, WKWebView

## 폴더 구조

```text
.
├── Bookmark hardware/   # ESP32 펌웨어와 PlatformIO 설정
├── Bookmark software/   # 모바일 웹앱, Node.js 서버, Gemini 분석, iOS 래퍼
└── README.md
```

## 소프트웨어 실행

```bash
cd "Bookmark software"
cp .env.example .env
# .env에 GEMINI_API_KEY 입력
npm install
npm test
npm start
```

서버 실행 후 노트북에서는 `http://localhost:5173`, 같은 Wi-Fi의 휴대폰에서는 터미널에 출력되는 주소로 접속합니다.

## 하드웨어 빌드

PlatformIO가 설치된 환경에서 다음 명령을 실행합니다.

```bash
cd "Bookmark hardware"
pio run
pio run --target upload
pio device monitor --baud 115200
```

## 현재 구현 범위

- 최근 30초 영상·음성 순환 기록 및 앱 전송
- 최근 30초 분석과 ESP 카메라 한 장 분석
- Gemini 분석 및 서버 측 최종 선별
- 환자·보호자 프로필 연동과 추억 저장·재생·삭제
- 네트워크 전환 중 촬영 데이터 복구 및 중복 저장 방지

현재 프로토타입에서 Gemini 분석 시작은 앱 버튼으로 수행합니다. 음성 이벤트 기반 자동 분석, 실제 배터리 측정, 상용 수준의 인증·암호화 및 실제 환자 대상 효과 검증은 후속 개발 범위입니다.

## 개인정보 보호

실제 API 키, 환자 정보와 촬영 미디어는 저장소에 포함하지 않습니다. `.env`, `data/patients.json`, `media/memories/`는 Git에서 제외됩니다.

## 협업 규칙

- `develop`: 개발용 기본 브랜치
- `feat/기능이름`, `fix/버그이름`: 기능별 브랜치에서 작업 후 PR 생성
- `main`: 발표 또는 배포 시 `develop`을 병합
- 커밋 예시: `feat: 추억 분석 기능 추가`, `fix: 영상 전송 재시도 수정`
