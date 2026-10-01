#ifndef PSRAM_BUFFER_H
#define PSRAM_BUFFER_H

#include "config.h"

// JPEG 프레임 한 장을 담을 구조체
struct VideoFrame {
    uint8_t* data;
    size_t len;
    uint32_t timestamp;
};

class PsramBufferManager {
private:
    VideoFrame frames[VIDEO_RING_FRAMES];
    int head = 0;
    int count = 0;

public:
    PsramBufferManager() {
        // 프레임 포인터 초기화
        for (int i = 0; i < VIDEO_RING_FRAMES; i++) {
            frames[i].data = nullptr;
            frames[i].len = 0;
        }
    }

    void addFrame(uint8_t* jpegData, size_t jpegLen) {
        if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
            // 이미 데이터가 있으면 구형 프레임 메모리 해제
            if (frames[head].data != nullptr) {
                free(frames[head].data);
            }

            // PSRAM(외부 확장 램)에 메모리 할당 (ps_malloc 사용 필수)
            frames[head].data = (uint8_t*)ps_malloc(jpegLen);
            if (frames[head].data != nullptr) {
                memcpy(frames[head].data, jpegData, jpegLen);
                frames[head].len = jpegLen;
                frames[head].timestamp = millis();
                
                head = (head + 1) % VIDEO_RING_FRAMES;
                if (count < VIDEO_RING_FRAMES) count++;
            }
            xSemaphoreGive(bufferMutex);
        }
    }

    int getCount() { return count; }
    
    // 이펙티브한 순차 출력을 위한 인덱스 계산 함수
    VideoFrame getFrame(int index) {
        int targetIdx = (head - count + index + VIDEO_RING_FRAMES) % VIDEO_RING_FRAMES;
        return frames[targetIdx];
    }
};

extern PsramBufferManager* videoBufferManager;

#endif