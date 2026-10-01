// ==========================================
// config.h (PSRAM & Wi-Fi 하이브리드 버전)
// ==========================================
#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <WiFi.h>
#include <WebServer.h>
#include "esp_camera.h"
#include <driver/i2s.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>

// ==========================================
// WI-FI SOFTAP CONFIG (목걸이 자체 와이파이)
// ==========================================
#define WIFI_SSID "Bookmark_Necklace"
#define WIFI_PASSWORD "12345678"
#define WIFI_RETURN_WINDOW_MS 45000 // 영상 전송 후 아이폰의 일반 Wi-Fi 복귀 및 분석 시간 확보

// ==========================================
// AUDIO CONFIG (16kHz, 16bit, 30초 분량)
// ==========================================
#define SAMPLE_RATE 16000
#define BUFFER_SECONDS 30
#define AUDIO_BUFFER_SIZE (SAMPLE_RATE * BUFFER_SECONDS) // 480,000 샘플 (약 960KB)

// ==========================================
// VIDEO CONFIG (링 버퍼 프레임 수 제한)
// ==========================================
#define FPS 4
#define VIDEO_RING_FRAMES (FPS * BUFFER_SECONDS) // 고화질 120프레임, PSRAM 사용량 안정화
#define FRAME_INTERVAL_MS (1000 / FPS)

// ==========================================
// AI & BLE
// ==========================================
#define AI_THRESHOLD 0.4
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// ==========================================
// GLOBALS
// ==========================================
extern int16_t *audioBuffer;
extern volatile size_t audioWriteIndex;
extern bool ticDetected;
extern bool deviceConnected;
extern BLECharacteristic *pCharacteristic;
extern SemaphoreHandle_t bufferMutex;

// 통신 상태 플래그
extern volatile bool wifiActive;
extern unsigned long wifiStartTime;

// ==========================================
// TASKS & FUNCTIONS
// ==========================================
void audioTask(void *pv);
void cameraTask(void *pv);
void aiTask(void *pv);
void wifiControlTask(void *pv);
void startWiFiServer();
void stopWiFiServer();

#endif
