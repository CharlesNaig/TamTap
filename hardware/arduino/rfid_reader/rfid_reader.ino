/**
 * TAMTAP v7.0 - Arduino RFID Reader
 * RC522 RFID Module for Registration System
 * 
 * Wiring for Arduino Uno + RC522:
 * --------------------------------
 * RC522 Pin  -> Arduino Uno Pin
 * SDA (SS)   -> Pin 10
 * SCK        -> Pin 13
 * MOSI       -> Pin 11
 * MISO       -> Pin 12
 * IRQ        -> Not connected
 * GND        -> GND
 * RST        -> Pin 9
 * 3.3V       -> 3.3V (IMPORTANT: RC522 is 3.3V only!)
 * 
 * Protocol:
 * - Sends "READY" on startup
 * - When card detected, sends "CARD:<UID>" (e.g., "CARD:1234567890")
 * - Receives "SCAN" command to start scanning
 * - Receives "STOP" command to stop scanning
 */

#include <SPI.h>
#include <MFRC522.h>

// Pin definitions
#define SS_PIN 10   // SDA pin
#define RST_PIN 9   // RST pin

// Create MFRC522 instance
MFRC522 rfid(SS_PIN, RST_PIN);

// State
bool scanning = false;
unsigned long lastCardTime = 0;
unsigned long cardDebounce = 1500; // 1.5 second debounce between same card reads
String lastCardUID = "";

bool initRC522() {
    // Hardware reset: pull RST LOW then HIGH to force cold start
    digitalWrite(RST_PIN, LOW);
    delay(50);
    digitalWrite(RST_PIN, HIGH);
    delay(50);
    
    // Initialize SPI bus and MFRC522
    SPI.begin();
    rfid.PCD_Init();
    delay(200); // Some clones need extra stabilization time
    
    // Verify communication via version register
    byte version = rfid.PCD_ReadRegister(rfid.VersionReg);
    if (version == 0x00 || version == 0xFF) {
        return false;
    }
    
    Serial.print("INFO:RC522_VERSION_");
    Serial.println(version, HEX);
    return true;
}

void setup() {
    // Initialize serial communication
    Serial.begin(9600);
    while (!Serial) {
        ; // Wait for serial port to connect (needed for native USB)
    }
    
    // RST pin as output for hardware reset
    pinMode(RST_PIN, OUTPUT);
    
    // Retry RC522 init up to 3 times with hardware reset
    bool rc522Found = false;
    for (byte attempt = 1; attempt <= 3; attempt++) {
        Serial.print("INFO:INIT_ATTEMPT_");
        Serial.println(attempt);
        
        rc522Found = initRC522();
        if (rc522Found) break;
        
        delay(500); // Wait before retry
    }
    
    if (!rc522Found) {
        Serial.println("ERROR:RC522_NOT_FOUND");
    } else {
        Serial.println("READY");
    }
}

void loop() {
    // Check for serial commands
    if (Serial.available() > 0) {
        String command = Serial.readStringUntil('\n');
        command.trim();
        
        if (command == "SCAN") {
            scanning = true;
            lastCardUID = "";
            Serial.println("ACK:SCANNING");
        } else if (command == "STOP") {
            scanning = false;
            Serial.println("ACK:STOPPED");
        } else if (command == "PING") {
            Serial.println("PONG");
        } else if (command == "STATUS") {
            if (scanning) {
                Serial.println("STATUS:SCANNING");
            } else {
                Serial.println("STATUS:IDLE");
            }
        }
    }
    
    // Only scan if enabled
    if (!scanning) {
        delay(50);
        return;
    }
    
    // Look for new cards
    if (!rfid.PICC_IsNewCardPresent()) {
        delay(50);
        return;
    }
    
    // Select the card
    if (!rfid.PICC_ReadCardSerial()) {
        delay(50);
        return;
    }
    
    // Get UID as string
    String cardUID = getUIDString();
    
    // Debounce - prevent reading same card multiple times
    unsigned long currentTime = millis();
    if (cardUID == lastCardUID && (currentTime - lastCardTime) < cardDebounce) {
        rfid.PICC_HaltA();
        rfid.PCD_StopCrypto1();
        return;
    }
    
    // New card detected
    lastCardUID = cardUID;
    lastCardTime = currentTime;
    
    // Send card UID
    Serial.print("CARD:");
    Serial.println(cardUID);
    
    // Stop scanning after card detected (single-shot mode)
    scanning = false;
    
    // Halt PICC and stop encryption
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
}

/**
 * Convert UID bytes to decimal string
 * Similar format to SimpleMFRC522 on Raspberry Pi
 */
String getUIDString() {
    unsigned long uid = 0;
    
    // Convert bytes to unsigned long (up to 4 bytes)
    for (byte i = 0; i < rfid.uid.size && i < 4; i++) {
        uid = uid << 8;
        uid = uid | rfid.uid.uidByte[i];
    }
    
    return String(uid);
}

/**
 * Alternative: Get UID as hex string
 * Uncomment if you prefer hex format
 */
/*
String getUIDHex() {
    String uid = "";
    for (byte i = 0; i < rfid.uid.size; i++) {
        if (rfid.uid.uidByte[i] < 0x10) {
            uid += "0";
        }
        uid += String(rfid.uid.uidByte[i], HEX);
    }   
    uid.toUpperCase();
    return uid;
}
*/
