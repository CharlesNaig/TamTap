#include <SPI.h>
#include <MFRC522.h>

#define SS_PIN 10
#define RST_PIN 5

MFRC522 mfrc522(SS_PIN, RST_PIN);

bool rc522Ready = false;

bool performStartupDiagnostic() {
  Serial.println(F("\n=== RC522 STARTUP DIAGNOSTIC ===\n"));
  
  // Step 1: SPI
  SPI.begin();
  Serial.println(F("[1/5] SPI initialized"));
  
  // Step 2: RC522 init
  mfrc522.PCD_Init();
  delay(50);  // Allow stabilization
  Serial.println(F("[2/5] RC522 initialized"));
  
  // Step 3: Firmware version check
  byte version = mfrc522.PCD_ReadRegister(mfrc522.VersionReg);
  Serial.print(F("[3/5] Firmware: 0x"));
  Serial.println(version, HEX);
  
  if (version == 0x00 || version == 0xFF) {
    Serial.println(F("\n*** FAIL: No communication with RC522 ***"));
    Serial.println(F("Check: SDA->D10, SCK->D13, MOSI->D11, MISO->D12"));
    Serial.println(F("Check: 3.3V power, GND, RST->D5"));
    return false;
  }
  
  if (version != 0x91 && version != 0x92) {
    Serial.print(F("WARNING: Unexpected version 0x"));
    Serial.println(version, HEX);
  }
  
  // Step 4: Antenna gain
  mfrc522.PCD_WriteRegister(mfrc522.RFCfgReg, 0x70); 
  byte gain = (mfrc522.PCD_ReadRegister(mfrc522.RFCfgReg) >> 4) & 0x07;
  Serial.print(F("[4/5] Antenna gain: "));
  Serial.print(gain);
  Serial.println(F("/7"));
  
  // Step 5: Self-test
  Serial.print(F("[5/5] Self-test: "));
  bool selfTest = mfrc522.PCD_PerformSelfTest();
  Serial.println(selfTest ? F("PASS") : F("FAIL"));
  
  // Re-init required after self-test
  mfrc522.PCD_Init();
  
  Serial.println(F("\n=== DIAGNOSTIC COMPLETE ==="));
  
  if (selfTest && version != 0x00 && version != 0xFF) {
    Serial.println(F("STATUS: READY - Waiting for card...\n"));
    return true;
  } else {
    Serial.println(F("STATUS: FAILED - Check wiring\n"));
    return false;
  }
}

void setup() {
  Serial.begin(9600);
  while (!Serial);
  
  // Retry diagnostic up to 3 times
  for (byte attempt = 1; attempt <= 3; attempt++) {
    Serial.print(F("Attempt "));
    Serial.print(attempt);
    Serial.println(F("/3"));
    
    rc522Ready = performStartupDiagnostic();
    if (rc522Ready) break;
    
    delay(1000);
  }
  
  if (!rc522Ready) {
    Serial.println(F("RC522 OFFLINE - Check hardware and reset"));
  }
}

void loop() {
  if (!rc522Ready) {
    delay(5000);
    rc522Ready = performStartupDiagnostic();  // Retry periodically
    return;
  }
  
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    return;
  }
  
  // Card detected
  Serial.print(F("UID:"));
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    Serial.print(mfrc522.uid.uidByte[i] < 0x10 ? " 0" : " ");
    Serial.print(mfrc522.uid.uidByte[i], HEX);
  }
  
  Serial.print(F(" | Type: "));
  Serial.println(mfrc522.PICC_GetTypeName(mfrc522.PICC_GetType(mfrc522.uid.sak)));
  
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  
  delay(1000);  // Debounce
}