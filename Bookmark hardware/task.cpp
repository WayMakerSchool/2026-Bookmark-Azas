#include "task.h"
#include "config.h"
#include "psram_buffer.h"

// 전역 변수 공간 정의
PsramBufferManager* videoBufferManager = nullptr;
int16_t *audioBuffer = nullptr;
volatile size_t audioWriteIndex = 0;
bool ticDetected = false;
SemaphoreHandle_t bufferMutex = nullptr;

volatile bool wifiActive = false;
unsigned long wifiStartTime = 0;

// =====================================================
// CAMERA TASK (상시 녹화)
// =====================================================
void cameraTask(void *pv) {
    videoBufferManager = new PsramBufferManager();
    TickType_t xLastWakeTime = xTaskGetTickCount();
    while(true) {
        camera_fb_t *fb = esp_camera_fb_get();
        if (fb) {
            if (videoBufferManager != nullptr) {
                videoBufferManager->addFrame(fb->buf, fb->len);
            }
            esp_camera_fb_return(fb);
        }
        vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(FRAME_INTERVAL_MS));
    }
}

// =====================================================
// AUDIO TASK (상시 녹음)
// =====================================================
void audioTask(void *pv) {
    while (audioBuffer == nullptr) { vTaskDelay(pdMS_TO_TICKS(10)); }
    size_t bytesRead = 0;
    const size_t chunkSamples = 512;
    int16_t tempBuf[chunkSamples];
    while(true) {
        i2s_read(I2S_NUM_0, tempBuf, chunkSamples * sizeof(int16_t), &bytesRead, portMAX_DELAY);
        size_t samplesRead = bytesRead / sizeof(int16_t);
        if (bufferMutex != nullptr && xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
            for (size_t i = 0; i < samplesRead; i++) {
                audioBuffer[audioWriteIndex] = tempBuf[i];
                audioWriteIndex = (audioWriteIndex + 1) % AUDIO_BUFFER_SIZE;
            }
            xSemaphoreGive(bufferMutex);
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

// =====================================================
// WI-FI CONTROL TASK
// =====================================================
void wifiControlTask(void *pv) {
    extern WebServer server;

    startWiFiServer();

    Serial.println("=================================");
    Serial.println("Wi-Fi transfer mode started");
    Serial.println("=================================");

    while(true) {
        if (wifiActive) {
            server.handleClient();
        } else {
            stopWiFiServer();
            Serial.printf("Waiting %u seconds for Gemini analysis...\n", WIFI_RETURN_WINDOW_MS / 1000);
            vTaskDelay(pdMS_TO_TICKS(WIFI_RETURN_WINDOW_MS));
            startWiFiServer();
            Serial.println("Bookmark_Necklace SoftAP is available again.");
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
