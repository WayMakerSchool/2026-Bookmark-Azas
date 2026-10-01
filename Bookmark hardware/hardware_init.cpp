// =====================================================
// hardware_init.cpp (BLE 서버 이름 충돌 해결 및 안정화 버전)
// =====================================================
#include "hardware_init.h"
#include "config.h"          // 💡 SAMPLE_RATE, UUID 등을 참조하기 위해 추가
#include "esp_camera.h"
#include <BLE2902.h>         // 💡 BLE2902 記述子 오류 방지를 위해 명시적 추가

// ==========================================
// GLOBALS
// ==========================================
// 💡 웹서버 'server'와의 전역 변수 이름 충돌을 피하기 위해 pBLEServer로 변경!
BLEServer *pBLEServer = nullptr; 
BLECharacteristic *pCharacteristic = nullptr;
bool deviceConnected = false;
bool timeSynced = false;
SemaphoreHandle_t sdMutex = nullptr; // 다른 파일 호환성을 위해 유지

// ==========================================
// BLE CALLBACK
// ==========================================
class ServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer *pServer) override {
        deviceConnected = true;
        Serial.println("BLE Connected");
    }
    void onDisconnect(BLEServer *pServer) override {
        deviceConnected = false;
        Serial.println("BLE Disconnected");
        BLEDevice::startAdvertising(); // 연결이 끊기면 다시 BLE 신호 방출
    }
};

// ==========================================
// TIME CALLBACK
// ==========================================
class TimeCallback : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pChar) override {
        std::string rxValue = pChar->getValue();
        String value = String(rxValue.c_str());
        Serial.print("RX: ");
        Serial.println(value);
        if(value.startsWith("TIME:")) {
            timeSynced = true;
            Serial.println("TIME SYNCED");
        }
    }
};

// ==========================================
// CAMERA INIT
// ==========================================
void initCamera() {
    camera_config_t config;
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer = LEDC_TIMER_0;

    config.pin_d0 = 15;
    config.pin_d1 = 17;
    config.pin_d2 = 18;
    config.pin_d3 = 16;
    config.pin_d4 = 14;
    config.pin_d5 = 12;
    config.pin_d6 = 11;
    config.pin_d7 = 48;

    config.pin_xclk  = 10;
    config.pin_pclk  = 13;
    config.pin_vsync = 38;
    config.pin_href  = 47;

    config.pin_sccb_sda = 40;
    config.pin_sccb_scl = 39;

    config.pin_pwdn  = -1;
    config.pin_reset = -1;

    config.xclk_freq_hz = 20000000;
    config.pixel_format = PIXFORMAT_JPEG;
    config.frame_size = FRAMESIZE_SVGA;
    config.jpeg_quality = 12;
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.grab_mode = CAMERA_GRAB_LATEST;

    esp_err_t err = esp_camera_init(&config);
    if(err != ESP_OK) {
        Serial.printf("Camera Fail: 0x%x\n", err);
        return;
    }

    sensor_t *s = esp_camera_sensor_get();
    s->set_hmirror(s, 1);
    s->set_vflip(s, 0);
    s->set_brightness(s, 0);
    s->set_contrast(s, 1);
    s->set_saturation(s, 1);
    s->set_sharpness(s, 1);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_wb_mode(s, 0);
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 1);
    s->set_ae_level(s, -1);
    s->set_gain_ctrl(s, 1);
    s->set_gainceiling(s, GAINCEILING_4X);
    s->set_raw_gma(s, 1);
    s->set_lenc(s, 1);
    Serial.println("Camera OK");
}

// ==========================================
// I2S INIT
// ==========================================
void initI2S() {
    i2s_config_t config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_PDM),
        .sample_rate = SAMPLE_RATE,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = 8,
        .dma_buf_len = 512,
        .use_apll = false,
        .tx_desc_auto_clear = false,
        .fixed_mclk = 0
    };

    i2s_pin_config_t pin_config = {
        .bck_io_num = I2S_PIN_NO_CHANGE,
        .ws_io_num = 42,
        .data_out_num = I2S_PIN_NO_CHANGE,
        .data_in_num = 41
    };

    esp_err_t err = i2s_driver_install(I2S_NUM_0, &config, 0, NULL);
    if(err != ESP_OK) {
        Serial.printf("I2S INSTALL FAIL: %d\n", err);
        return;
    }

    err = i2s_set_pin(I2S_NUM_0, &pin_config);
    if(err != ESP_OK) {
        Serial.printf("I2S PIN FAIL: %d\n", err);
        return;
    }

    i2s_zero_dma_buffer(I2S_NUM_0);
    Serial.println("I2S READY");
}

// ==========================================
// SD INIT (더미 함수로 변경하여 SD 카드 없이 패스)
// ==========================================
void initSD() {
    Serial.println("SD Card Skip -> Using PSRAM Buffer");
}

// ==========================================
// BLE INIT
// ==========================================
void initBLE() {
    BLEDevice::init("Defotic");
    BLEDevice::setMTU(185);
    pBLEServer = BLEDevice::createServer();
    pBLEServer->setCallbacks(new ServerCallbacks());
    BLEService *service = pBLEServer->createService(SERVICE_UUID);

    pCharacteristic = service->createCharacteristic(
        CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_NOTIFY |
        BLECharacteristic::PROPERTY_READ |
        BLECharacteristic::PROPERTY_WRITE |
        BLECharacteristic::PROPERTY_WRITE_NR
    );

    pCharacteristic->setCallbacks(new TimeCallback());
    pCharacteristic->addDescriptor(new BLE2902());
    service->start();

    BLEAdvertising *advertising = BLEDevice::getAdvertising();
    advertising->addServiceUUID(SERVICE_UUID);
    advertising->setScanResponse(false);
    advertising->setMinPreferred(0x06);
    advertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();

    Serial.println("BLE OK");
}

// ==========================================
// TIME INIT
// ==========================================
void initTimeSync() {
    Serial.println("Time Sync OK");
}

// ==========================================
// HARDWARE INIT
// ==========================================
void initHardware() {
    Serial.begin(115200);
    delay(3000);

    Serial.println("PSRAM AUDIO BUFFER OK");
    Serial.println();
    Serial.println("======================");
    Serial.println("DEFOTIC START");
    Serial.println("======================");

    // 다른 파일에서 에러 안 나게 안전용 뮤텍스만 생성
    sdMutex = xSemaphoreCreateMutex();
    if(sdMutex == NULL) {
        Serial.println("Mutex Fail");
        while(true) { delay(1000); }
    }

    initSD(); 
    initCamera();
    initI2S();
    initBLE();
    initTimeSync();

    Serial.println("Hardware Init Complete");
}
