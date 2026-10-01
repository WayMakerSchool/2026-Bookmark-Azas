// =====================================================
// ai_task.cpp (하드웨어 통신 우선 빌드용 바이패스 버전)
// =====================================================

#include "config.h"

// =====================================================
// AI CRITICAL SECTION
// =====================================================
portMUX_TYPE aiMux = portMUX_INITIALIZER_UNLOCKED;

// =====================================================
// AI 임시 정의 (Edge Impulse 라이브러리 없을 때 에러 방지용)
// =====================================================
#define MOCK_RAW_SAMPLE_COUNT 16000 // 1초치 샘플

// =====================================================
// AI BUFFER
// =====================================================
static int16_t inferenceBuffer[MOCK_RAW_SAMPLE_COUNT];

// =====================================================
// AI TASK
// =====================================================
void aiTask(void *pv) {
    Serial.println("[AI Task] Started (Bypass Mode)");

    while(true) {
        size_t startIdx;

        // 오디오 버퍼가 충분히 쌓였는지 확인
        if (audioWriteIndex >= MOCK_RAW_SAMPLE_COUNT) {
            startIdx = audioWriteIndex - MOCK_RAW_SAMPLE_COUNT;
        } else {
            startIdx = AUDIO_BUFFER_SIZE + audioWriteIndex - MOCK_RAW_SAMPLE_COUNT;
        }

        // =============================================
        // AUDIO BUFFER COPY (경쟁 조건 방지)
        // =============================================
        portENTER_CRITICAL(&aiMux);
        for(size_t i = 0; i < MOCK_RAW_SAMPLE_COUNT; i++) {
            size_t idx = (startIdx + i) % AUDIO_BUFFER_SIZE;
            if (audioBuffer != nullptr) {
                inferenceBuffer[i] = audioBuffer[idx];
            }
        }
        portEXIT_CRITICAL(&aiMux);

        // =============================================
        // TODO: Edge Impulse 라이브러리 결합 시 하단 복구 예정
        // =============================================
        /*
        signal_t signal;
        signal.total_length = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
        signal.get_data = &get_signal_data;
        ei_impulse_result_t result = {0};
        
        EI_IMPULSE_ERROR err = run_classifier(&signal, &result, false);
        ...
        */

        // [임시 테스트용 외부 트리거]
        // 지금은 AI가 없으므로 시리얼 모니터나 BLE로 틱 감지 테스트를 하고 싶다면
        // 이 플래그를 true로 바꾸는 식으로 테스트가 가능해.
        if (ticDetected) {
            Serial.println("====== [EVENT] TIC DETECTED VIA TRIGGER ======");
        }

        // 과도한 CPU 점유 방지 (100ms 대기)
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}