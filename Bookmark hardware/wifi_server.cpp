
#include "config.h"
#include "psram_buffer.h"

WebServer server(80);
constexpr uint32_t STREAM_FRAME_INTERVAL_MS = 125;
constexpr char STREAM_BOUNDARY[] = "bookmark-frame";

bool writeClientFully(WiFiClient &client, const uint8_t *data, size_t length) {
    size_t written = 0;
    while (written < length && client.connected()) {
        size_t chunk = client.write(data + written, length - written);
        if (chunk == 0) {
            vTaskDelay(pdMS_TO_TICKS(1));
            continue;
        }
        written += chunk;
    }
    return written == length;
}

void addCorsHeaders() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.sendHeader("Access-Control-Expose-Headers", "X-Bookmark-Frames, X-Bookmark-Duration-Ms");
}

void handleVideoDownload() {
    addCorsHeaders();
    if (videoBufferManager == nullptr) {
        server.send(503, "text/plain", "Camera Not Ready");
        return;
    }
    if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
        server.send(503, "text/plain", "Buffer Busy");
        return;
    }

    int totalFrames = videoBufferManager->getCount();
    size_t totalBytes = 0;
    for (int i = 0; i < totalFrames; i++) {
        VideoFrame frame = videoBufferManager->getFrame(i);
        if (frame.data != nullptr && frame.len > 0) totalBytes += sizeof(uint32_t) + frame.len;
    }

    if (totalBytes == 0) {
        xSemaphoreGive(bufferMutex);
        server.send(503, "text/plain", "Frame Not Ready");
        return;
    }

    server.sendHeader("X-Bookmark-Frames", String(totalFrames));
    server.sendHeader("X-Bookmark-Duration-Ms", String(BUFFER_SECONDS * 1000));
    server.setContentLength(totalBytes);
    server.send(200, "application/octet-stream", "");

    WiFiClient client = server.client();
    bool transferOk = true;
    for (int i = 0; i < totalFrames && transferOk; i++) {
        VideoFrame frame = videoBufferManager->getFrame(i);
        if (frame.data == nullptr || frame.len == 0) continue;
        uint32_t frameLen = frame.len;
        transferOk = writeClientFully(client, reinterpret_cast<uint8_t *>(&frameLen), sizeof(frameLen))
            && writeClientFully(client, frame.data, frame.len);
    }
    xSemaphoreGive(bufferMutex);

    Serial.printf(
        "Video transfer: %s, frames=%d, bytes=%u\n",
        transferOk ? "complete" : "disconnected",
        totalFrames,
        static_cast<unsigned int>(totalBytes)
    );
}

void handleLiveFrame() {
    addCorsHeaders();

    if (videoBufferManager == nullptr) {
        server.send(503, "text/plain", "Camera Not Ready");
        return;
    }

    uint8_t *frameCopy = nullptr;
    size_t frameLen = 0;

    if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(300)) == pdTRUE) {
        int totalFrames = videoBufferManager->getCount();
        if (totalFrames > 0) {
            VideoFrame latest = videoBufferManager->getFrame(totalFrames - 1);
            if (latest.data != nullptr && latest.len > 0) {
                frameCopy = (uint8_t *)ps_malloc(latest.len);
                if (frameCopy != nullptr) {
                    memcpy(frameCopy, latest.data, latest.len);
                    frameLen = latest.len;
                }
            }
        }
        xSemaphoreGive(bufferMutex);
    }

    if (frameCopy == nullptr || frameLen == 0) {
        server.send(503, "text/plain", "Frame Not Ready");
        return;
    }

    server.setContentLength(frameLen);
    server.send(200, "image/jpeg", "");
    server.client().write(frameCopy, frameLen);
    free(frameCopy);
}

void handleMjpegStream() {
    WiFiClient client = server.client();
    client.setNoDelay(true);
    client.print("HTTP/1.1 200 OK\r\n");
    client.print("Access-Control-Allow-Origin: *\r\n");
    client.print("Cache-Control: no-store, no-cache, must-revalidate\r\n");
    client.print("Pragma: no-cache\r\n");
    client.printf("Content-Type: multipart/x-mixed-replace; boundary=%s\r\n", STREAM_BOUNDARY);
    client.print("Connection: close\r\n\r\n");

    uint8_t *frameCopy = nullptr;
    size_t frameCapacity = 0;
    uint32_t lastTimestamp = 0;
    uint32_t lastFrameSentAt = 0;

    while (client.connected()) {
        uint32_t now = millis();
        if (now - lastFrameSentAt < STREAM_FRAME_INTERVAL_MS) {
            vTaskDelay(pdMS_TO_TICKS(5));
            continue;
        }

        size_t frameLen = 0;
        uint32_t frameTimestamp = lastTimestamp;

        if (videoBufferManager != nullptr &&
            xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            int totalFrames = videoBufferManager->getCount();
            if (totalFrames > 0) {
                VideoFrame latest = videoBufferManager->getFrame(totalFrames - 1);
                if (latest.data != nullptr && latest.len > 0 && latest.timestamp != lastTimestamp) {
                    if (latest.len > frameCapacity) {
                        uint8_t *largerBuffer = (uint8_t *)ps_malloc(latest.len);
                        if (largerBuffer != nullptr) {
                            free(frameCopy);
                            frameCopy = largerBuffer;
                            frameCapacity = latest.len;
                        }
                    }
                    if (frameCopy != nullptr && frameCapacity >= latest.len) {
                        memcpy(frameCopy, latest.data, latest.len);
                        frameLen = latest.len;
                        frameTimestamp = latest.timestamp;
                    }
                }
            }
            xSemaphoreGive(bufferMutex);
        }

        if (frameLen == 0) {
            vTaskDelay(pdMS_TO_TICKS(5));
            continue;
        }

        char frameHeader[128];
        int headerLength = snprintf(
            frameHeader,
            sizeof(frameHeader),
            "--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
            STREAM_BOUNDARY,
            (unsigned int)frameLen
        );

        if (client.write((const uint8_t *)frameHeader, headerLength) != (size_t)headerLength ||
            client.write(frameCopy, frameLen) != frameLen ||
            client.write((const uint8_t *)"\r\n", 2) != 2) {
            break;
        }

        lastTimestamp = frameTimestamp;
        lastFrameSentAt = millis();
        vTaskDelay(pdMS_TO_TICKS(1));
    }

    free(frameCopy);
    client.stop();
}

void handleAudioDownload() {
    addCorsHeaders();
    if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
        server.setContentLength(AUDIO_BUFFER_SIZE * 2); // 16비트 = 2바이트
        server.send(200, "application/octet-stream", "");
        
        server.client().write((uint8_t*)audioBuffer, AUDIO_BUFFER_SIZE * 2);
        xSemaphoreGive(bufferMutex);
    } else {
        server.send(503, "text/plain", "Buffer Busy");
    }
}

// 영상 수신을 마치면 아이폰이 인터넷 Wi-Fi로 돌아갈 수 있도록 AP를 잠시 내린다.
void handleTransferComplete() {
    addCorsHeaders();
    server.send(200, "text/plain", "OK");
    Serial.println("App report: Transfer complete. Pausing SoftAP for Gemini analysis.");
    wifiActive = false;
}

void handleRoot() {
    addCorsHeaders();
    server.send(200, "text/plain", "Hello! Bookmark Necklace Server is Running!");
}

void handleStatus() {
    addCorsHeaders();
    server.send(200, "application/json", "{\"ready\":true,\"ssid\":\"Bookmark_Necklace\"}");
}

void startWiFiServer() {
    Serial.println("Starting SoftAP...");
    WiFi.softAP(WIFI_SSID, WIFI_PASSWORD);
    WiFi.setSleep(false);
    
    IPAddress IP = WiFi.softAPIP();
    Serial.printf("AP IP address: %u.%u.%u.%u\n", IP[0], IP[1], IP[2], IP[3]);

    static bool routesRegistered = false;
    if (!routesRegistered) {
        server.on("/video", HTTP_GET, handleVideoDownload);
        server.on("/live", HTTP_GET, handleLiveFrame);
        server.on("/stream", HTTP_GET, handleMjpegStream);
        server.on("/audio", HTTP_GET, handleAudioDownload);
        server.on("/done", HTTP_POST, handleTransferComplete);
        server.on("/status", HTTP_GET, handleStatus);
        server.on("/", handleRoot);
        routesRegistered = true;
    }
    server.begin();
    
    wifiActive = true;
    wifiStartTime = millis();
}

void stopWiFiServer() {
    server.stop();
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    wifiActive = false;
    Serial.println("Wi-Fi SoftAP paused for phone internet return.");
}
