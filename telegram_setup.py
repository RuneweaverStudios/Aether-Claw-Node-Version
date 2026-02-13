#!/usr/bin/env python3
"""
Telegram Bot Setup for Aether-Claw

OpenClaw-style Telegram bot setup with BotFather instructions and pairing code.
Similar to OpenClaw's telegram setup flow.
"""

import os
import sys
import time
import json
import urllib.request
import urllib.error
import random
import string
from pathlib import Path
from typing import Optional, Tuple


def tty_input(prompt: str = "", default: str = "") -> str:
    """Get input with /dev/tty fallback."""
    print(prompt, end='', flush=True)
    try:
        line = input()
        return line.strip() if line.strip() else default
    except EOFError:
        try:
            with open('/dev/tty', 'r') as tty:
                line = tty.readline()
                return line.strip() if line.strip() else default
        except Exception:
            return default


def generate_pairing_code() -> str:
    """Generate a 6-digit pairing code."""
    return ''.join(random.choices(string.digits, k=6))


def verify_bot_token(token: str) -> Tuple[bool, Optional[dict]]:
    """Verify a Telegram bot token."""
    try:
        url = f"https://api.telegram.org/bot{token}/getMe"
        with urllib.request.urlopen(url, timeout=10) as resp:
            result = json.loads(resp.read())
            if result.get('ok'):
                return True, result.get('result')
            return False, None
    except Exception as e:
        return False, None


def send_telegram_message(token: str, chat_id: str, message: str) -> bool:
    """Send a message via Telegram bot."""
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        data = json.dumps({
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "Markdown"
        }).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            return result.get('ok', False)
    except Exception:
        return False


def wait_for_start_command(token: str, timeout: int = 300) -> Optional[str]:
    """
    Wait for user to send /start command to the bot.
    Returns chat_id if found, None if timeout.
    """
    print("\n  ⏳ Waiting for /start command...")
    print(f"  (Timeout: {timeout} seconds)")
    
    start_time = time.time()
    offset = 0
    
    while time.time() - start_time < timeout:
        try:
            url = f"https://api.telegram.org/bot{token}/getUpdates"
            if offset:
                url += f"?offset={offset}"
            
            with urllib.request.urlopen(url, timeout=30) as resp:
                result = json.loads(resp.read())
                
            if result.get('ok'):
                updates = result.get('result', [])
                for update in updates:
                    offset = update['update_id'] + 1
                    
                    if 'message' in update:
                        msg = update['message']
                        chat = msg['chat']
                        text = msg.get('text', '').strip()
                        
                        if text == '/start':
                            chat_id = str(chat['id'])
                            user_name = msg.get('from', {}).get('first_name', 'User')
                            print(f"\n  ✓ Received /start from {user_name}")
                            return chat_id
        except Exception:
            pass
        
        time.sleep(2)
    
    return None


def wait_for_pairing_code(token: str, chat_id: str, pairing_code: str, timeout: int = 300) -> bool:
    """
    Wait for user to send pairing code to the bot.
    Returns True if code matches, False if timeout or wrong code.
    """
    print(f"\n  📝 Pairing code: {pairing_code}")
    print(f"  ⏳ Waiting for pairing code...")
    print(f"  (Send this code to your bot in Telegram)")
    print(f"  (Timeout: {timeout} seconds)")
    
    start_time = time.time()
    offset = 0
    
    while time.time() - start_time < timeout:
        try:
            url = f"https://api.telegram.org/bot{token}/getUpdates?offset={offset}"
            
            with urllib.request.urlopen(url, timeout=30) as resp:
                result = json.loads(resp.read())
                
            if result.get('ok'):
                updates = result.get('result', [])
                for update in updates:
                    offset = update['update_id'] + 1
                    
                    if 'message' in update:
                        msg = update['message']
                        chat = msg['chat']
                        text = msg.get('text', '').strip()
                        
                        # Only check messages from the paired chat
                        if str(chat['id']) == chat_id:
                            if text == pairing_code:
                                print(f"\n  ✓ Pairing code verified!")
                                return True
                            elif text.startswith('/'):
                                # Ignore commands
                                continue
        except Exception:
            pass
        
        time.sleep(2)
    
    return False


def setup_telegram(env_file: Path) -> bool:
    """
    Run Telegram bot setup with BotFather instructions and pairing.
    Returns True if setup successful, False if skipped or failed.
    """
    print("\n[7/7] 📱 Telegram Bot Setup")
    print("-" * 50)
    print("  Connect Aether-Claw to Telegram for remote access:")
    print("  • Chat with your agent from anywhere")
    print("  • Receive notifications and updates")
    print("  • Control your agent remotely")
    print()
    
    setup = tty_input("  Set up Telegram bot? [y/N]: ", "n").lower()
    if setup != 'y':
        print("  ℹ Telegram setup skipped")
        return False
    
    print()
    print("  📋 Step 1: Create a bot with BotFather")
    print()
    print("  1. Open Telegram and search for @BotFather")
    print("  2. Send /newbot to BotFather")
    print("  3. Choose a name for your bot (e.g., 'My Aether-Claw')")
    print("  4. Choose a username (must end in 'bot', e.g., 'my_aetherclaw_bot')")
    print("  5. BotFather will give you a token like: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11")
    print()
    
    input("  Press Enter when you have your bot token...")
    print()
    
    # Get bot token
    token = None
    while not token:
        token_input = tty_input("  Enter your bot token: ").strip()
        
        if not token_input:
            print("  ⚠ Token cannot be empty")
            continue
        
        # Verify token
        print("  ⏳ Verifying token...")
        is_valid, bot_info = verify_bot_token(token_input)
        
        if is_valid and bot_info:
            token = token_input
            bot_username = bot_info.get('username', 'unknown')
            bot_name = bot_info.get('first_name', 'unknown')
            print(f"  ✓ Bot verified: {bot_name} (@{bot_username})")
        else:
            print("  ✗ Invalid token. Please check and try again.")
            retry = tty_input("  Try again? [Y/n]: ", "y").lower()
            if retry == 'n':
                return False
    
    print()
    print("  📋 Step 2: Pair your bot")
    print()
    print(f"  1. Open Telegram and search for @{bot_username}")
    print("  2. Click Start or send /start to your bot")
    print()
    
    # Generate pairing code
    pairing_code = generate_pairing_code()
    
    # Wait for /start
    chat_id = wait_for_start_command(token, timeout=300)
    
    if not chat_id:
        print("\n  ✗ Timeout: Did not receive /start command")
        print("  ℹ Make sure you sent /start to your bot")
        return False
    
    # Send welcome message with pairing code
    welcome_msg = (
        f"👋 Hello! I'm Aether-Claw.\n\n"
        f"To complete pairing, send me this code:\n\n"
        f"`{pairing_code}`\n\n"
        f"This code will expire in 5 minutes."
    )
    
    if send_telegram_message(token, chat_id, welcome_msg):
        print("  ✓ Sent pairing code to bot")
    else:
        print("  ⚠ Could not send message (you can still enter code manually)")
    
    # Wait for pairing code
    paired = wait_for_pairing_code(token, chat_id, pairing_code, timeout=300)
    
    if not paired:
        print("\n  ✗ Pairing failed: Code not received or timeout")
        return False
    
    # Send confirmation message
    confirm_msg = (
        "✅ Pairing successful!\n\n"
        "I'm now connected to your Aether-Claw instance. "
        "You can chat with me here, and I'll respond as your AI assistant."
    )
    send_telegram_message(token, chat_id, confirm_msg)
    
    # Save to .env file
    print("\n  💾 Saving credentials...")
    try:
        # Read existing .env
        env_lines = []
        if env_file.exists():
            with open(env_file, 'r') as f:
                env_lines = f.readlines()
        
        # Update or add TELEGRAM_BOT_TOKEN
        token_found = False
        chat_id_found = False
        new_lines = []
        
        for line in env_lines:
            if line.startswith('TELEGRAM_BOT_TOKEN='):
                new_lines.append(f'TELEGRAM_BOT_TOKEN={token}\n')
                token_found = True
            elif line.startswith('TELEGRAM_CHAT_ID='):
                new_lines.append(f'TELEGRAM_CHAT_ID={chat_id}\n')
                chat_id_found = True
            else:
                new_lines.append(line)
        
        if not token_found:
            new_lines.append(f'\nTELEGRAM_BOT_TOKEN={token}\n')
        if not chat_id_found:
            new_lines.append(f'TELEGRAM_CHAT_ID={chat_id}\n')
        
        # Write back
        with open(env_file, 'w') as f:
            f.writelines(new_lines)
        
        # Set environment variables
        os.environ['TELEGRAM_BOT_TOKEN'] = token
        os.environ['TELEGRAM_CHAT_ID'] = chat_id
        
        print("  ✓ Credentials saved to .env")
        print(f"  ✓ Bot: @{bot_username}")
        print(f"  ✓ Chat ID: {chat_id}")
        print()
        print("  💡 Start the bot with: aetherclaw telegram")
        
        return True
        
    except Exception as e:
        print(f"  ✗ Error saving credentials: {e}")
        print(f"  ℹ Token: {token[:20]}...")
        print(f"  ℹ Chat ID: {chat_id}")
        print("  ℹ You can set these manually:")
        print(f"     export TELEGRAM_BOT_TOKEN='{token}'")
        print(f"     export TELEGRAM_CHAT_ID='{chat_id}'")
        return False


if __name__ == "__main__":
    env_file = Path(__file__).parent / '.env'
    setup_telegram(env_file)
