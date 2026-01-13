#!/usr/bin/env python3
# 🚀 TAMTAP REGISTRATION GUI - Pygame Version
# 📝 Student/Teacher Registration + RFID Integration

import pygame
import json
import os
import time
from datetime import datetime
from mfrc522 import SimpleMFRC522

# ========================================
# INIT + CONSTANTS
# ========================================
pygame.init()
SCREEN_WIDTH, SCREEN_HEIGHT = 800, 600
screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption("🚀 TAMTAP - Student Registration")
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

# ========================================
# DATABASE FUNCTIONS (SHARED)
# ========================================
def load_db():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, 'r') as f:
            return json.load(f)
    return {"students": {}, "teachers": {}, "attendance": []}

def save_db(db):
    with open(DB_FILE, 'w') as f:
        json.dump(db, f, indent=2)

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
        
        # Input fields
        self.inputs = {
            'name': TextInput(100, 200, 600, 50, "Full Name"),
            'uid': TextInput(100, 280, 600, 50, "RFID UID (or scan card)", 12),
            'grade': TextInput(100, 360, 600, 50, "Grade/Section (optional)")
        }
        
        # Messages
        self.message = ""
        self.message_timer = 0
        
        # RFID reader
        self.reader = SimpleMFRC522()
        self.rfid_scanning = False
        
    def draw_menu(self):
        screen.fill(WHITE)
        
        # Title
        title = font_large.render("🚀 TAMTAP REGISTRATION", True, BLUE)
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
            font_medium.render("📚 REGISTER STUDENT", True, WHITE),
            font_medium.render("👨‍🏫 REGISTER TEACHER", True, WHITE),
            font_medium.render("❌ EXIT", True, WHITE)
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
        header = font_large.render(f"📝 REGISTER {role_text}", True, BLUE)
        header_rect = header.get_rect(center=(SCREEN_WIDTH//2, 50))
        screen.blit(header, header_rect)
        
        # Instructions
        instr = font_small.render("👆 Scan RFID card or type UID", True, BLACK)
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
            font_medium.render("🔍 SCAN RFID", True, WHITE),
            font_medium.render("💾 SAVE", True, WHITE),
            font_medium.render("⬅ BACK", True, WHITE)
        ]
        
        for i, text in enumerate(btn_texts):
            rects = [scan_btn, save_btn, back_btn]
            text_rect = text.get_rect(center=rects[i].center)
            screen.blit(text, text_rect)
        
        # Message
        if self.message:
            msg_surf = font_small.render(self.message, True, GREEN)
            screen.blit(msg_surf, (100, 530))
        
        return [scan_btn, save_btn, back_btn]
    
    def draw_success(self):
        screen.fill(WHITE)
        
        success_text = font_large.render("✅ SUCCESS!", True, GREEN)
        success_rect = success_text.get_rect(center=(SCREEN_WIDTH//2, 200))
        screen.blit(success_text, success_rect)
        
        name = self.inputs['name'].text[:20]
        uid = self.inputs['uid'].text
        role = self.role.upper()
        
        info1 = font_medium.render(f"👤 {name}", True, BLACK)
        info2 = font_medium.render(f"🆔 UID: {uid}", True, BLACK)
        info3 = font_medium.render(f"📚 {role}", True, BLACK)
        
        screen.blit(info1, (200, 280))
        screen.blit(info2, (200, 330))
        screen.blit(info3, (200, 380))
        
        back_btn = pygame.Rect(300, 450, 200, 60)
        pygame.draw.rect(screen, BLUE, back_btn)
        back_text = font_medium.render("🏠 MAIN MENU", True, WHITE)
        back_rect = back_text.get_rect(center=back_btn.center)
        screen.blit(back_text, back_rect)
        
        return [back_btn]
    
    def scan_rfid(self):
        try:
            print("👆 Tap RFID card...")
            id, text = self.reader.read_no_block()
            if id:
                self.inputs['uid'].text = str(id)
                self.message = f"✅ RFID scanned: {id}"
                self.message_timer = 120
                return True
        except:
            pass
        return False
    
    def save_user(self):
        name = self.inputs['name'].text.strip()
        uid = self.inputs['uid'].text.strip()
        
        if not name or not uid:
            self.message = "❌ Please fill Name and UID!"
            self.message_timer = 120
            return False
        
        # Check if already registered
        db = load_db()
        if uid in db["students"] or uid in db["teachers"]:
            self.message = "❌ UID already registered!"
            self.message_timer = 120
            return False
        
        # Save new user
        db[self.role][uid] = {
            "name": name,
            "grade": self.inputs['grade'].text.strip(),
            "registered": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        save_db(db)
        
        self.message = f"✅ {name} registered!"
        self.message_timer = 120
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
                        if buttons[0].collidepoint(event.pos):  # Scan RFID
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
            
            pygame.display.flip()
            clock.tick(60)
        
        pygame.quit()

# ========================================
# 🎯 RUN REGISTRATION
# ========================================
if __name__ == "__main__":
    print("🚀 Starting TAMTAP Registration...")
    app = RegistrationApp()
    app.run()
    print("👋 Registration closed.")
