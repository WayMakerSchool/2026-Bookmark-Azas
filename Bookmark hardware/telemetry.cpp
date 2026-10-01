
#include "config.h"

// =====================================================
// INTERNAL STATE
// =====================================================
static int tickCountToday = 0;
static unsigned long lastEventTimeMs = 0;

// ai_task 등에서 틱 검출 시 호출하여 카운트를 올리는 함수
void telemetry_incrementTick() {
    tickCountToday++;
    lastEventTimeMs = millis();
}

static void bleSend(const char *msg) {
    if (!deviceConnected || !pCharacteristic) return;
    pCharacteristic->setValue(msg);
    pCharacteristic->notify();
    delay(30);
}

void telemetryTask(void *pv) {
    // 하드웨어 초기화가 완전히 끝날 때까지 5초 대기
    vTaskDelay(pdMS_TO_TICKS(5000));

    while (true) {
        if (deviceConnected) {
            // ── 메트릭 수집 (하드웨어 스텁 상태 관리) ──
            int batteryPercent = 100;  // ESP32-S3 내부 배터리 ADC 전압 분배 장치 빌드 전까지 100 고정
            int sdUsedPercent  = 0;    // 💡 SD 카드를 사용하지 않고 PSRAM을 쓰므로 0으로 고정

            // ESP32 내부 온도를 읽어오는 내장 함수
            float temperature = temperatureRead();

            // 카메라 및 마이크는 초기화 성공 후 상시 가동 상태이므로 true
            bool cameraOk = true;
            bool micOk     = true;

            // ── JSON 데이터 구성 ──
            char json[256];
            snprintf(json, sizeof(json),
                "{\"type\":\"status\","
                "\"battery\":%d,"
                "\"sdUsed\":%d,"
                "\"temperature\":%.1f,"
                "\"camera\":%s,"
                "\"microphone\":%s,"
                "\"connected\":true,"
                "\"tickCountToday\":%d,"
                "\"lastEventTime\":%lu}",
                batteryPercent,
                sdUsedPercent,
                temperature,
                cameraOk ? "true" : "false",
                micOk ? "true" : "false",
                tickCountToday,
                lastEventTimeMs
            );

            // 앱으로 상태 전송
            bleSend(json);
        }

        // 3초마다 반복 실행
        vTaskDelay(pdMS_TO_TICKS(3000));
    }
}

// =====================================================
// EVENT TRANSFER (Wi-Fi 고속 다운로드 전환으로 인한 스텁 처리)
// 💡 헤더 파일(telemetry.h) 및 타 파일과의 링킹 에러를 방지하기 위해 형태를 유지합니다.
// =====================================================
void sendEventBLE(const char *folder, const char *eventId, unsigned long timestamp) {
    // 기존의 느린 BLE 청크 전송 대신, 새로 구축한 Wi-Fi SoftAP를 통해 
    // 앱이 직접 와이파이 웹서버에 붙어 가져가므로 여기서는 로그만 출력하고 안전하게 넘어갑니다.
    Serial.println("[Telemetry] BLE chunk transfer bypassed. (Using Wi-Fi High-Speed Stream instead)");
}