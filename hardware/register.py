#!/usr/bin/env python3
"""
🚀 TAMTAP v6.2 REGISTRATION GUI - Pygame Version
📝 Student/Teacher Registration + RFID Integration
Synced with tamtap_v6.2.py database schema
"""

import pygame
import json
import os
import time
import logging
from datetime import datetime

import RPi.GPIO as GPIO
from mfrc522 import SimpleMFRC522

# ========================================
# 📋 LOGGING CONFIGURATION
# ========================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('TAMTAP_REG')

# ========================================
# INIT + CONSTANTS
# ========================================
pygame.init()
SCREEN_WIDTH, SCREEN_HEIGHT = 800, 600
screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption("TAMTAP v6.2 - Registration")
clock = pygame.time.Clock()
font_large = pygame.font.Font(None, 48)
font_medium = pygame.font.Font(None, 32)
font_small = pygame.font.Font(None, 24)

# Colors
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
BLUE = (0, 100, 200)
GREEN = (0, 200, 100)
RED = (200, 50, 50)
GRAY = (200, 200, 200)
DARK_GRAY = (100, 100, 100)

DB_FILE = "tamtap_users.json"

# GPIO setup for RFID
GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)

# ========================================
# DATABASE FUNCTIONS (SYNCED WITH v6.2)
# ========================================
def load_db():
    """Load database - synced with tamtap_v6.2.py schema"""
    try:
        if os.path.exists(DB_FILE):
            with open(DB_FILE, 'r') as f:
                return json.load(f)
    except json.JSONDecodeError as e:
        logger.error("Database JSON error: %s", e)
    except Exception as e:
        logger.error("Database load error: %s", e)
    return {"students": {}, "teachers": {}, "attendance": []}

def save_db(db):
    """Save database to JSON file"""
    try:
        with open(DB_FILE, 'w') as f:
            json.dump(db, f, indent=2)
        logger.info("Database saved successfully")
    except Exception as e:
        logger.error("Failed to save database: %s", e)

# ========================================
# TEXT INPUT CLASS
# ========================================
class TextInput:
    def __init__(self, x, y, w, h, label_text, max_length=20):
        self.rect = pygame.Rect(x, y, w, h)
        self.label = label_text
        self.text = ""
        self.max_length = max_length
        self.active = False
        self.blink_timer = 0
        
    def handle_event(self, event):
        if event.type == pygame.MOUSEBUTTONDOWN:
            self.active = self.rect.collidepoint(event.pos)
        
        if event.type == pygame.KEYDOWN and self.active:
            if event.key == pygame.K_RETURN:
                self.active = False
            elif event.key == pygame.K_BACKSPACE:
                self.text = self.text[:-1]
            elif event.unicode.isprintable() and len(self.text) < self.max_length:
                self.text += event.unicode
    
    def update(self):
        self.blink_timer += 1
        if self.blink_timer > 60:
            self.blink_timer = 0
    
    def draw(self, screen):
        # Background
        color = DARK_GRAY if self.active else GRAY
        pygame.draw.rect(screen, color, self.rect)
        pygame.draw.rect(screen, WHITE, self.rect, 3)
        
        # Text
        text_surf = font_medium.render(self.text, True, WHITE)
        screen.blit(text_surf, (self.rect.x + 10, self.rect.y + 5))
        
        # Cursor
        if self.active and self.blink_timer < 30:
            cursor_x = self.rect.x + 10 + text_surf.get_width()
            pygame.draw.line(screen, WHITE, (cursor_x, self.rect.y + 5), 
                           (cursor_x, self.rect.y + self.rect.height - 5), 3)
        
        # Label
        label_surf = font_small.render(self.label, True, BLACK)
        screen.blit(label_surf, (self.rect.x, self.rect.y - 25))

# ========================================
# MAIN REGISTRATION CLASS
# ========================================
class RegistrationApp:
    def __init__(self):
        self.state = "menu"  # menu, register, rfid_scan, success
        self.role = "student"  # student, teacher
        
        # Input fields (synced with v6.2 schema)
        self.inputs = {
            'name': TextInput(100, 200, 600, 50, "Full Name"),
            'nfc_id': TextInput(100, 280, 600, 50, "NFC ID (scan card)", 15),
            'grade': TextInput(100, 360, 600, 50, "Grade/Section (e.g., 12 ICT B)")
        }
        
        # Messages
        self.message = ""
        self.message_timer = 0
        
        # RFID reader
        try:
            self.reader = SimpleMFRC522()
            logger.info("RFID reader initialized")
        except Exception as e:
            logger.error("RFID reader init failed: %s", e)
            self.reader = None
        
        self.rfid_scanning = False
        
    def draw_menu(self):
        screen.fill(WHITE)
        
        # Title
        title = font_large.render("TAMTAP v6.2 REGISTRATION", True, BLUE)
        title_rect = title.get_rect(center=(SCREEN_WIDTH//2, 100))
        screen.blit(title, title_rect)
        
        # Buttons
        student_btn = pygame.Rect(150, 250, 500, 80)
        teacher_btn = pygame.Rect(150, 360, 500, 80)
        exit_btn = pygame.Rect(150, 470, 500, 80)
        
        pygame.draw.rect(screen, GREEN, student_btn)
        pygame.draw.rect(screen, BLUE, teacher_btn)
        pygame.draw.rect(screen, RED, exit_btn)
        
        # Button text
        texts = [
            font_medium.render("REGISTER STUDENT", True, WHITE),
            font_medium.render("REGISTER TEACHER", True, WHITE),
            font_medium.render("EXIT", True, WHITE)
        ]
        
        for i, text in enumerate(texts):
            rects = [student_btn, teacher_btn, exit_btn]
            text_rect = text.get_rect(center=rects[i].center)
            screen.blit(text, text_rect)
        
        return [student_btn, teacher_btn, exit_btn]
    
    def draw_register_form(self):
        screen.fill(WHITE)
        
        # Header
        role_text = "STUDENT" if self.role == "student" else "TEACHER"
        header = font_large.render(f"REGISTER {role_text}", True, BLUE)
        header_rect = header.get_rect(center=(SCREEN_WIDTH//2, 50))
        screen.blit(header, header_rect)
        
        # Instructions
        instr = font_small.render("Scan NFC card or enter ID manually", True, BLACK)
        screen.blit(instr, (100, 140))
        
        # Draw inputs
        for input_field in self.inputs.values():
            input_field.draw(screen)
        
        # Buttons
        scan_btn = pygame.Rect(100, 450, 200, 60)
        save_btn = pygame.Rect(320, 450, 200, 60)
        back_btn = pygame.Rect(540, 450, 200, 60)
        
        pygame.draw.rect(screen, GREEN, scan_btn)
        pygame.draw.rect(screen, BLUE, save_btn)
        pygame.draw.rect(screen, GRAY, back_btn)
        
        btn_texts = [
            font_medium.render("SCAN NFC", True, WHITE),
            font_medium.render("SAVE", True, WHITE),
            font_medium.render("BACK", True, WHITE)
        ]
        
        for i, text in enumerate(btn_texts):
            rects = [scan_btn, save_btn, back_btn]
            text_rect = text.get_rect(center=rects[i].center)
            screen.blit(text, text_rect)
        
        # Message
        if self.message:
            msg_color = GREEN if "OK" in self.message or "scanned" in self.message else RED
            msg_surf = font_small.render(self.message, True, msg_color)
            screen.blit(msg_surf, (100, 530))
        
        return [scan_btn, save_btn, back_btn]
    
    def draw_success(self):
        screen.fill(WHITE)
        
        success_text = font_large.render("REGISTRATION SUCCESS!", True, GREEN)
        success_rect = success_text.get_rect(center=(SCREEN_WIDTH//2, 200))
        screen.blit(success_text, success_rect)
        
        name = self.inputs['name'].text[:20]
        nfc_id = self.inputs['nfc_id'].text
        grade = self.inputs['grade'].text
        role = self.role.upper()
        
        info1 = font_medium.render(f"Name: {name}", True, BLACK)
        info2 = font_medium.render(f"NFC ID: {nfc_id}", True, BLACK)
        info3 = font_medium.render(f"Grade: {grade}", True, BLACK)
        info4 = font_medium.render(f"Role: {role}", True, BLACK)
        
        screen.blit(info1, (200, 280))
        screen.blit(info2, (200, 320))
        screen.blit(info3, (200, 360))
        screen.blit(info4, (200, 400))
        
        back_btn = pygame.Rect(300, 470, 200, 60)
        pygame.draw.rect(screen, BLUE, back_btn)
        back_text = font_medium.render("MAIN MENU", True, WHITE)
        back_rect = back_text.get_rect(center=back_btn.center)
        screen.blit(back_text, back_rect)
        
        return [back_btn]
    
    def scan_rfid(self):
        """Scan NFC card and populate nfc_id field"""
        if not self.reader:
            self.message = "ERROR: NFC reader not available"
            self.message_timer = 120
            logger.error("NFC reader not initialized")
            return False
        
        try:
            nfc_id, text = self.reader.read_no_block()
            if nfc_id:
                self.inputs['nfc_id'].text = str(nfc_id)
                self.message = f"NFC scanned: {nfc_id}"
                self.message_timer = 120
                logger.info("NFC card scanned: %s", nfc_id)
                return True
        except Exception as e:
            logger.error("NFC scan error: %s", e)
            self.message = "ERROR: NFC scan failed"
            self.message_timer = 120
        return False
    
    def save_user(self):
        """Save user to database - synced with v6.2 schema"""
        name = self.inputs['name'].text.strip()
        nfc_id = self.inputs['nfc_id'].text.strip()
        grade = self.inputs['grade'].text.strip()
        
        # Validation
        if not name:
            self.message = "ERROR: Name is required"
            self.message_timer = 120
            return False
        
        if not nfc_id:
            self.message = "ERROR: NFC ID is required (scan card)"
            self.message_timer = 120
            return False
        
        # Check if already registered (unique nfc_id constraint)
        db = load_db()
        students = db.get("students", {})
        teachers = db.get("teachers", {})
        
        if nfc_id in students or nfc_id in teachers:
            self.message = "ERROR: NFC ID already registered"
            self.message_timer = 120
            logger.warning("Duplicate NFC ID attempted: %s", nfc_id)
            return False
        
        # Save new user with v6.2 schema
        collection = "students" if self.role == "student" else "teachers"
        db[collection][nfc_id] = {
            "name": name,
            "grade": grade,
            "registered": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        save_db(db)
        
        self.message = f"OK: {name} registered!"
        self.message_timer = 120
        logger.info("User registered: %s (NFC: %s, Role: %s)", name, nfc_id, self.role)
        return True
    
    def update(self):
        if self.message_timer > 0:
            self.message_timer -= 1
            if self.message_timer == 0:
                self.message = ""
    
    def run(self):
        running = True
        
        while running:
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    running = False
                
                if self.state == "menu":
                    buttons = self.draw_menu()
                    if event.type == pygame.MOUSEBUTTONDOWN:
                        if buttons[0].collidepoint(event.pos):
                            self.state = "register"
                            self.role = "student"
                        elif buttons[1].collidepoint(event.pos):
                            self.state = "register"
                            self.role = "teacher"
                        elif buttons[2].collidepoint(event.pos):
                            running = False
                
                elif self.state == "register":
                    # Handle input events
                    for input_field in self.inputs.values():
                        input_field.handle_event(event)
                    
                    buttons = self.draw_register_form()
                    
                    if event.type == pygame.MOUSEBUTTONDOWN:
                        if buttons[0].collidepoint(event.pos):  # Scan NFC
                            self.scan_rfid()
                        elif buttons[1].collidepoint(event.pos):  # Save
                            if self.save_user():
                                self.state = "success"
                        elif buttons[2].collidepoint(event.pos):  # Back
                            self.state = "menu"
                
                elif self.state == "success":
                    buttons = self.draw_success()
                    if event.type == pygame.MOUSEBUTTONDOWN:
                        if buttons[0].collidepoint(event.pos):
                            self.state = "menu"
                            # Reset form
                            for input_field in self.inputs.values():
                                input_field.text = ""
            
            # Update
            if self.state == "register":
                for input_field in self.inputs.values():
                    input_field.update()
                self.update()
                # Continuous NFC scanning in register state
                self.scan_rfid()
            
            pygame.display.flip()
            clock.tick(60)
        
        pygame.quit()
        GPIO.cleanup()
        logger.info("Registration app closed")

# ========================================
# RUN REGISTRATION
# ========================================
if __name__ == "__main__":
    logger.info("Starting TAMTAP v6.2 Registration...")
    try:
        app = RegistrationApp()
        app.run()
    except Exception as e:
        logger.error("Application error: %s", e)
    finally:
        GPIO.cleanup()
        logger.info("Registration closed")
