#include <Arduino.h>
#include "config.h"
#include "hardware_init.h"
#include "task.h"
#include "telemetry.h"


int frameIndex = 0;
unsigned long lastCaptureTime = 0;
String lastImagePath = "";
volatile bool eventSaving = false;

void setup() {
    // 1. 하드웨어 초기화 (카메라, 마이크, BLE 등 세팅)
    initHardware(); 

    // 2. [🔥 핵심 해결책] 데이터 보호를 위한 자물쇠(뮤텍스) 생성
    // task.cpp의 audioTask가 사용하기 전에 반드시 setup에서 먼저 만들어야 합니다.
    if (bufferMutex == NULL) {
        bufferMutex = xSemaphoreCreateMutex();
    }

    // 3. 오디오 녹음용 PSRAM 버퍼 할당
    audioBuffer = (int16_t *)ps_malloc(AUDIO_BUFFER_SIZE * sizeof(int16_t));
    if (audioBuffer == nullptr) {
        Serial.println("PSRAM Audio Buffer Allocation Failed!");
        while (true) { delay(1000); }
    }
    Serial.println("PSRAM Audio Buffer Allocated Successfully.");

    // 4. 멀티태스킹 태스크 생성 (자물쇠가 안전하게 생성된 후 일꾼들 배치)
    // 오디오 상시 녹음 (Core 1)
    xTaskCreatePinnedToCore(audioTask, "AudioTask", 8192, NULL, 1, NULL, 1);
    
    // 카메라 상시 녹화 (Core 0)
    xTaskCreatePinnedToCore(cameraTask, "CameraTask", 8192, NULL, 1, NULL, 0);
    
    // Wi-Fi 제어 및 앱 통신 서버 (Core 0)
    xTaskCreatePinnedToCore(wifiControlTask, "WiFiTask", 4096, NULL, 1, NULL, 0);

    // AI 데이터 전처리 / 우회 태스크 (Core 1)
    xTaskCreatePinnedToCore(aiTask, "AiTask", 8192, NULL, 1, NULL, 1);

    Serial.println("=======================");
    Serial.println("DEFOTIC BOOT COMPLETE");
    Serial.println("=======================");
}

void loop() {
    // FreeRTOS 멀티태스킹 시스템을 쓰기 때문에 메인 루프는 쉽니다.
    vTaskDelay(pdMS_TO_TICKS(1000));
}