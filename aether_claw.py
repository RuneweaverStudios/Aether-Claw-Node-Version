#!/usr/bin/env python3
"""
Aether-Claw Main CLI Entry Point

Unified command-line interface for Aether-Claw operations.
"""

import argparse
import logging
import sys
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def cmd_index(args):
    """Run brain indexer."""
    from brain_index import BrainIndexer

    indexer = BrainIndexer()

    if args.file:
        version = indexer.index_file(Path(args.file))
        print(f"Indexed {args.file} (version {version})")
    else:
        results = indexer.index_all()
        print(f"Indexed {len(results)} files:")
        for name, version in results.items():
            print(f"  {name}: v{version}")


def cmd_keygen(args):
    """Generate RSA key pair."""
    from keygen import KeyManager

    manager = KeyManager()

    if args.info:
        info = manager.get_key_info()
        print("Key Information:")
        for key, value in info.items():
            print(f"  {key}: {value}")
        return

    passphrase = None
    if args.passphrase:
        import getpass
        passphrase = getpass.getpass('Enter passphrase: ').encode()

    try:
        private, public = manager.generate_key_pair(
            passphrase=passphrase,
            overwrite=args.overwrite
        )
        print(f"Key pair generated:")
        print(f"  Private: {private}")
        print(f"  Public: {public}")
    except FileExistsError as e:
        print(f"Error: {e}")
        print("Use --overwrite to replace existing keys")


def cmd_sign_skill(args):
    """Sign a skill."""
    from safe_skill_creator import SafeSkillCreator

    creator = SafeSkillCreator()

    if args.verify:
        is_valid, message = creator.verify_skill(args.verify)
        print(message)
        sys.exit(0 if is_valid else 1)

    if args.list:
        skills = creator.list_skills()
        print(f"Found {len(skills)} skills:")
        for skill in skills:
            status = "VALID" if skill.get('signature_valid') else "INVALID"
            print(f"  [{status}] {skill['name']}")
        return

    if args.create:
        try:
            signed = creator.create_skill_from_file(
                Path(args.create),
                name=args.name,
                description=args.description or "",
                skip_scan=args.skip_scan
            )
            path = creator.save_skill(signed)
            print(f"Skill signed: {path}")
        except Exception as e:
            print(f"Error: {e}")
            sys.exit(1)


def cmd_verify_skills(args):
    """Verify all skills."""
    from tasks.skill_checker import check_all_skills

    result = check_all_skills()

    print(f"Total skills: {result.total_skills}")
    print(f"Valid: {result.valid_skills}")
    print(f"Invalid: {result.invalid_skills}")
    print(f"Unsigned: {result.unsigned_skills}")

    if result.invalid_skills > 0:
        print("\nInvalid skills:")
        for skill in result.skills:
            if not skill.signature_valid and skill.is_signed:
                print(f"  - {skill.skill_name}: {skill.error}")

    sys.exit(0 if result.invalid_skills == 0 else 1)


def cmd_heartbeat(args):
    """Run heartbeat daemon."""
    from heartbeat_daemon import HeartbeatDaemon

    daemon = HeartbeatDaemon(interval_minutes=args.interval)

    if args.status:
        status = daemon.get_status()
        print("Heartbeat Status:")
        for key, value in status.items():
            print(f"  {key}: {value}")
        return

    if args.task:
        result = daemon.execute_task(args.task)
        print(f"Task: {result.task_name}")
        print(f"Success: {result.success}")
        print(f"Message: {result.message}")
        return

    if args.run_once:
        results = daemon.run_once()
        print(f"Executed {len(results)} tasks:")
        for result in results:
            status = "OK" if result.success else "FAILED"
            print(f"  [{status}] {result.task_name}: {result.message}")
        return

    # Start daemon
    import signal

    def handle_signal(signum, frame):
        print("\nStopping...")
        daemon.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    daemon.start()
    print(f"Heartbeat started (interval: {daemon.interval_minutes} min)")
    print("Press Ctrl+C to stop")

    import time
    while daemon._running:
        time.sleep(1)


def cmd_dashboard(args):
    """Launch Streamlit dashboard."""
    import subprocess

    port = args.port or 8501

    cmd = [
        sys.executable, '-m', 'streamlit', 'run',
        str(Path(__file__).parent / 'dashboard.py'),
        '--server.port', str(port),
        '--server.headless', 'true'
    ]

    print(f"Starting dashboard on http://localhost:{port}")
    subprocess.run(cmd)


def cmd_onboard(args):
    """Interactive onboarding setup."""
    import os
    import getpass
    from pathlib import Path

    # ASCII Art Header
    print()
    print("  ╔════════════════════════════════════════════════════╗")
    print("  ║              🥚 AETHERCLAW ONBOARDING 🥚             ║")
    print("  ╚════════════════════════════════════════════════════╝")
    print()

    env_file = Path(__file__).parent / '.env'

    # Step 1: API Key Setup
    print("\n[1/6] 🔑 API Key Configuration")
    print("-" * 50)

    # Check for existing key
    existing_key = os.environ.get('OPENROUTER_API_KEY', '')

    # Also check .env file
    if not existing_key and env_file.exists():
        with open(env_file) as f:
            for line in f:
                if line.startswith('OPENROUTER_API_KEY='):
                    existing_key = line.split('=', 1)[1].strip()
                    if existing_key:
                        os.environ['OPENROUTER_API_KEY'] = existing_key
                    break

    if existing_key:
        masked = existing_key[:10] + '...' + existing_key[-4:] if len(existing_key) > 14 else '***'
        print(f"  Found API key: {masked}")
        change = input("  Use different key? [y/N]: ").strip().lower()
        if change != 'y':
            print("  ✓ Using existing API key")
        else:
            existing_key = ''
            print()

    if not existing_key:
        print("  Get your API key at: https://openrouter.ai/keys")
        print()
        key = getpass.getpass("  Enter OpenRouter API key: ").strip()
        if key:
            # Update .env file
            lines = []
            if env_file.exists():
                with open(env_file) as f:
                    lines = f.readlines()

            # Update or add the key
            key_found = False
            new_lines = []
            for line in lines:
                if line.startswith('OPENROUTER_API_KEY='):
                    new_lines.append(f'OPENROUTER_API_KEY={key}\n')
                    key_found = True
                else:
                    new_lines.append(line)

            if not key_found:
                new_lines.append(f'\nOPENROUTER_API_KEY={key}\n')

            with open(env_file, 'w') as f:
                f.writelines(new_lines)

            os.environ['OPENROUTER_API_KEY'] = key
            print("  ✓ API key saved")
        else:
            print("  ⚠ No API key provided - some features will be limited")

    # Step 2: Model Selection
    print("\n[2/6] 🧠 Model Selection")
    print("-" * 50)
    print("  PREMIUM REASONING:")
    print("  [1] Claude 3.7 Sonnet    $3/$15/M  - Best overall")
    print("  [2] Claude Opus 4.6      $5/$25/M  - Most powerful (1M ctx)")
    print("  [3] GLM 5                $0.80/$2.56/M - Z.AI flagship")
    print("  [4] Kimi K2.5            $0.45/$2.25/M - Visual coding")
    print("  [5] MiniMax M2.5         $0.30/$1.20/M - Office & coding")
    print()
    print("  BALANCED:")
    print("  [6] Gemini 2.5 Pro       - Google's best")
    print("  [7] GPT-4.1              - OpenAI flagship")
    print()
    print("  FAST/BUDGET:")
    print("  [8] Claude 3.7 Haiku     - Fast & cheap")
    print("  [9] Gemini 2.5 Flash     - Fast & efficient")
    print("  [0] DeepSeek V4          - Great value")
    print()
    print("  SPECIAL:")
    print("  [A] MiniMax M2-her (Pony) - Roleplay/chat")
    print("  [B] Custom model (paste from openrouter.ai/models)")
    print()

    try:
        choice = input("  Select model [1-0,A,B] (default: 1): ").strip().upper() or '1'
    except EOFError:
        choice = '1'
        print("1")

    models = {
        '1': ('anthropic/claude-3.7-sonnet', '$3/$15/M'),
        '2': ('anthropic/claude-opus-4.6', '$5/$25/M'),
        '3': ('z-ai/glm-5', '$0.80/$2.56/M'),
        '4': ('moonshotai/kimi-k2.5', '$0.45/$2.25/M'),
        '5': ('minimax/minimax-m2.5', '$0.30/$1.20/M'),
        '6': ('google/gemini-2.5-pro-preview', 'varies'),
        '7': ('openai/gpt-4.1', 'varies'),
        '8': ('anthropic/claude-3.7-haiku', '$0.80/$4/M'),
        '9': ('google/gemini-2.5-flash-preview', 'varies'),
        '0': ('deepseek/deepseek-chat-v4', 'budget'),
        'A': ('minimax/minimax-m2-her', '$0.30/$1.20/M'),
    }

    if choice == 'B':
        print("\n  📋 Open https://openrouter.ai/models in your browser")
        print("  Find your model and click the copy button, then paste here:")
        print()
        try:
            reasoning_model = input("  Paste model ID: ").strip()
        except EOFError:
            reasoning_model = 'anthropic/claude-3.7-sonnet'
            print("anthropic/claude-3.7-sonnet")
        if not reasoning_model:
            reasoning_model = 'anthropic/claude-3.7-sonnet'
        model_price = "(custom)"
    else:
        model_info = models.get(choice, ('anthropic/claude-3.7-sonnet', '$3/$15/M'))
        reasoning_model = model_info[0]
        model_price = model_info[1]

    print(f"\n  ✓ Selected: {reasoning_model} ({model_price})")

    # Action model
    print("\n  Action model (for fast tasks):")
    print("  [8] Haiku  [9] Flash  [0] DeepSeek  [Enter] Same as reasoning")
    try:
        action_choice = input("  Select (default: same): ").strip().upper() or ''
    except EOFError:
        action_choice = ''
        print("")

    if action_choice and action_choice in models:
        action_model = models[action_choice][0]
    elif action_choice and action_choice == 'B':
        try:
            action_model = input("  Paste model ID: ").strip()
        except EOFError:
            action_model = reasoning_model
        if not action_model:
            action_model = reasoning_model
    else:
        action_model = reasoning_model

    print(f"  ✓ Action model: {action_model}")
    print(f"  ✓ Action model: {action_model}")

    # Save to config
    config_file = Path(__file__).parent / 'swarm_config.json'
    if config_file.exists():
        import json
        with open(config_file) as f:
            config = json.load(f)
        config['models']['tier_1_model'] = reasoning_model
        config['models']['tier_2_model'] = action_model
        with open(config_file, 'w') as f:
            json.dump(config, f, indent=2)
        print("  ✓ Model configuration saved")

    # Step 3: RSA Keys
    print("\n[3/6] 🔐 Cryptographic Keys")
    print("-" * 50)

    from keygen import KeyManager
    manager = KeyManager()

    if manager.key_exists():
        print("  ✓ RSA keys already exist")
        info = manager.get_key_info()
        print(f"    Key location: {info.get('private_key_path', 'N/A')}")
    else:
        try:
            private, public = manager.generate_key_pair(overwrite=False)
            print("  ✓ Generated RSA-2048 key pair")
            print(f"    Private: {private}")
            print(f"    Public: {public}")
        except Exception as e:
            print(f"  ✗ Error: {e}")

    # Step 4: Gateway Daemon
    print("\n[4/6] 🚪 Gateway Daemon")
    print("-" * 50)

    try:
        start_daemon = input("  Start heartbeat daemon automatically? [Y/n]: ").strip().lower()
    except EOFError:
        start_daemon = ''
        print("Y")
    start_daemon = start_daemon != 'n'

    if start_daemon:
        # Create launch agent for macOS
        launch_dir = Path.home() / 'Library' / 'LaunchAgents'
        launch_dir.mkdir(parents=True, exist_ok=True)

        plist_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aetherclaw.heartbeat</string>
    <key>ProgramArguments</key>
    <array>
        <string>{sys.executable}</string>
        <string>{Path(__file__).parent / 'aether_claw.py'}</string>
        <string>heartbeat</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/aetherclaw.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/aetherclaw.log</string>
</dict>
</plist>'''

        plist_path = launch_dir / 'com.aetherclaw.heartbeat.plist'
        with open(plist_path, 'w') as f:
            f.write(plist_content)
        print(f"  ✓ Gateway daemon configured")
        print(f"    LaunchAgent: {plist_path}")
    else:
        print("  ℹ Gateway daemon not configured")

    # Step 5: Index Brain
    print("\n[5/6] 🧠 Memory Indexing")
    print("-" * 50)

    from brain_index import BrainIndexer
    indexer = BrainIndexer()

    try:
        results = indexer.index_all()
        print(f"  ✓ Indexed {len(results)} brain files")
    except Exception as e:
        print(f"  ✗ Error: {e}")

    # Step 6: Skills Check
    print("\n[6/6] 🔧 Skills Verification")
    print("-" * 50)

    from safe_skill_creator import SafeSkillCreator
    creator = SafeSkillCreator()

    try:
        skills = creator.list_skills()
        if skills:
            valid = sum(1 for s in skills if s.get('signature_valid'))
            print(f"  ✓ {valid}/{len(skills)} skills verified")
        else:
            print("  ℹ No skills yet - create with: aetherclaw sign-skill")
    except Exception as e:
        print(f"  ⚠ {e}")

    # Final Summary
    print()
    print("  ╔════════════════════════════════════════════════════╗")
    print("  ║           🐣 ONBOARDING COMPLETE! 🐣                 ║")
    print("  ╚════════════════════════════════════════════════════╝")
    print()

    # Ask to hatch
    print("  Ready to hatch into AetherClaw!")
    print()
    print("  [1] Hatch into TUI (Terminal Interface)")
    print("  [2] Launch Dashboard (Web UI)")
    print("  [3] Exit to shell")
    print()

    try:
        hatch = input("  Choose [1-3] (default: 1): ").strip() or '1'
    except EOFError:
        hatch = '1'
        print("1")

    if hatch == '1':
        print("\n  🐣 Hatching into TUI...")
        import subprocess
        tui_path = Path(__file__).parent / 'tui.py'
        os.execv(sys.executable, [sys.executable, str(tui_path)])
    elif hatch == '2':
        print("\n  🐣 Launching Dashboard...")
        import subprocess
        subprocess.run([sys.executable, '-m', 'streamlit', 'run',
                       str(Path(__file__).parent / 'dashboard.py'),
                       '--server.headless', 'true'])
    else:
        print("\n  Run these commands to get started:")
        print()
        print("    aetherclaw tui         # Terminal interface")
        print("    aetherclaw dashboard   # Web dashboard")
        print("    aetherclaw status      # System status")
        print()


def cmd_status(args):
    """Show system status."""
    from config_loader import load_config
    from brain_index import BrainIndexer
    from safe_skill_creator import SafeSkillCreator

    config = load_config()

    print("=" * 50)
    print("Aether-Claw Status")
    print("=" * 50)

    print(f"\nVersion: {config.version}")
    print(f"Brain Directory: {config.brain_dir}")
    print(f"Skills Directory: {config.skills_dir}")

    print("\n--- Safety ---")
    print(f"Safety Gate: {'Enabled' if config.safety_gate.enabled else 'Disabled'}")
    print(f"Kill Switch: {'Enabled' if config.kill_switch.enabled else 'Disabled'}")

    print("\n--- Memory ---")
    try:
        indexer = BrainIndexer()
        stats = indexer.get_stats()
        print(f"Indexed Files: {stats['total_files']}")
        print(f"Total Versions: {stats['total_versions']}")
        print(f"Last Indexed: {stats['last_indexed'] or 'Never'}")
    except Exception as e:
        print(f"Error: {e}")

    print("\n--- Skills ---")
    try:
        creator = SafeSkillCreator()
        skills = creator.list_skills()
        valid = sum(1 for s in skills if s.get('signature_valid'))
        print(f"Total Skills: {len(skills)}")
        print(f"Valid Signatures: {valid}")
    except Exception as e:
        print(f"Error: {e}")

    print("\n--- Swarm ---")
    print(f"Max Workers: {config.swarm.max_workers}")
    print(f"Isolation Mode: {config.swarm.isolation_mode}")

    print("\n--- Heartbeat ---")
    print(f"Enabled: {config.heartbeat.enabled}")
    print(f"Interval: {config.heartbeat.interval_minutes} min")


def cmd_kill_switch(args):
    """Manage kill switch."""
    from kill_switch import KillSwitch

    ks = KillSwitch()

    if args.arm:
        ks.arm()
        print("Kill switch ARMED")

    elif args.disarm:
        ks.disarm()
        print("Kill switch DISARMED")

    elif args.trigger:
        from kill_switch import TriggerReason
        try:
            reason = TriggerReason(args.trigger)
            ks.trigger(reason, args.details or "")
            print(f"Kill switch TRIGGERED: {reason.value}")
        except ValueError:
            print(f"Invalid reason. Valid options: {[r.value for r in TriggerReason]}")

    elif args.reset:
        if ks.reset():
            print("Kill switch RESET")
        else:
            print("Kill switch was not triggered")

    else:
        # Show status
        print(f"Armed: {ks.is_armed()}")
        print(f"Triggered: {ks.is_triggered()}")
        if ks.is_triggered():
            print(f"Reason: {ks.get_trigger_reason()}")
            print(f"Time: {ks.get_trigger_time()}")


def cmd_swarm(args):
    """Manage swarm operations."""
    from swarm.orchestrator import SwarmOrchestrator
    from swarm.worker import Task

    orchestrator = SwarmOrchestrator()

    if args.status:
        status = orchestrator.monitor_progress()
        print("Swarm Status:")
        print(f"  Total Workers: {status.total_workers}")
        print(f"  Active Workers: {status.active_workers}")
        print(f"  Pending Tasks: {status.pending_tasks}")
        print(f"  Completed Tasks: {status.completed_tasks}")
        print(f"  Failed Tasks: {status.failed_tasks}")
        return

    if args.task:
        task = Task(
            id=f"task-{args.task[:20]}",
            description=args.task
        )
        orchestrator.add_task(task)

        print(f"Running task: {args.task[:50]}...")
        results = orchestrator.run_until_complete()

        for completed in results:
            print(f"\nTask {completed.id}:")
            if completed.result:
                result_type = completed.result.get('type', 'unknown')
                print(f"  Type: {result_type}")
                if result_type == 'code':
                    code = completed.result.get('code', '')
                    print(f"  Code:\n{code[:500]}...")
                elif result_type == 'decomposition':
                    subtasks = completed.result.get('subtasks', [])
                    print(f"  Subtasks: {len(subtasks)}")
                    for st in subtasks:
                        print(f"    - {st.get('id')}: {st.get('description', '')[:50]}")
                else:
                    print(f"  Result: {str(completed.result)[:200]}")

            if completed.error:
                print(f"  Error: {completed.error}")


def cmd_tui(args):
    """Launch terminal TUI."""
    import subprocess
    tui_path = Path(__file__).parent / 'tui.py'
    subprocess.run([sys.executable, str(tui_path)])


def cmd_telegram(args):
    """Start Telegram bot."""
    import os

    token = args.token or os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_id = args.chat_id or os.environ.get('TELEGRAM_CHAT_ID')

    if not token:
        print("Error: Telegram bot token required.")
        print("Set TELEGRAM_BOT_TOKEN environment variable or use --token")
        sys.exit(1)

    print("Starting Telegram bot...")
    print(f"Token: {token[:20]}...")
    if chat_id:
        print(f"Chat ID: {chat_id}")

    try:
        import urllib.request
        import json
        import time

        # Get bot info
        url = f"https://api.telegram.org/bot{token}/getMe"
        with urllib.request.urlopen(url, timeout=10) as resp:
            result = json.loads(resp.read())
            if result.get('ok'):
                bot = result['result']
                print(f"Bot: @{bot.get('username', 'unknown')}")
            else:
                print(f"Error: {result}")
                sys.exit(1)

        print("\nBot is running. Send messages to interact with Aether-Claw.")
        print("Press Ctrl+C to stop.\n")

        # Simple polling loop
        offset = 0
        while True:
            try:
                # Get updates
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
                            text = msg.get('text', '')

                            if text:
                                print(f"[{chat.get('id')}] {msg.get('from', {}).get('first_name', 'User')}: {text}")

                                # Get AI response
                                from glm_client import GLMClient, ModelTier
                                client = GLMClient()

                                response = client.call(
                                    prompt=text,
                                    tier=ModelTier.TIER_1_REASONING,
                                    system_prompt="You are Aether-Claw, a secure AI assistant. Be helpful and concise."
                                )

                                if response.success:
                                    reply = response.content[:4000]  # Telegram limit
                                else:
                                    reply = f"Error: {response.error}"

                                # Send response
                                send_url = f"https://api.telegram.org/bot{token}/sendMessage"
                                data = json.dumps({
                                    "chat_id": chat['id'],
                                    "text": reply,
                                    "parse_mode": "Markdown"
                                }).encode()
                                req = urllib.request.Request(send_url, data=data, headers={"Content-Type": "application/json"})
                                urllib.request.urlopen(req, timeout=10)

                time.sleep(1)

            except urllib.error.URLError:
                time.sleep(5)
            except KeyboardInterrupt:
                print("\nStopping bot...")
                break

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description='Aether-Claw - Secure Swarm-Based AI Assistant',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # index command
    p_index = subparsers.add_parser('index', help='Index brain files')
    p_index.add_argument('--file', '-f', help='Index a specific file')
    p_index.set_defaults(func=cmd_index)

    # onboard command
    p_onboard = subparsers.add_parser('onboard', help='Interactive setup wizard')
    p_onboard.set_defaults(func=cmd_onboard)

    # keygen command
    p_keygen = subparsers.add_parser('keygen', help='Generate RSA keys')
    p_keygen.add_argument('--info', '-i', action='store_true', help='Show key info')
    p_keygen.add_argument('--overwrite', '-o', action='store_true', help='Overwrite existing')
    p_keygen.add_argument('--passphrase', '-p', action='store_true', help='Use passphrase')
    p_keygen.set_defaults(func=cmd_keygen)

    # sign-skill command
    p_sign = subparsers.add_parser('sign-skill', help='Sign a skill')
    p_sign.add_argument('--create', '-c', help='Create skill from file')
    p_sign.add_argument('--name', '-n', help='Skill name')
    p_sign.add_argument('--description', '-d', help='Skill description')
    p_sign.add_argument('--verify', '-v', help='Verify a skill')
    p_sign.add_argument('--list', '-l', action='store_true', help='List skills')
    p_sign.add_argument('--skip-scan', action='store_true', help='Skip security scan')
    p_sign.set_defaults(func=cmd_sign_skill)

    # verify-skills command
    p_verify = subparsers.add_parser('verify-skills', help='Verify all skills')
    p_verify.set_defaults(func=cmd_verify_skills)

    # heartbeat command
    p_heartbeat = subparsers.add_parser('heartbeat', help='Run heartbeat daemon')
    p_heartbeat.add_argument('--status', action='store_true', help='Show status')
    p_heartbeat.add_argument('--run-once', action='store_true', help='Run once')
    p_heartbeat.add_argument('--task', '-t', help='Execute specific task')
    p_heartbeat.add_argument('--interval', '-i', type=int, default=30, help='Interval in minutes')
    p_heartbeat.set_defaults(func=cmd_heartbeat)

    # dashboard command
    p_dashboard = subparsers.add_parser('dashboard', help='Launch dashboard')
    p_dashboard.add_argument('--port', '-p', type=int, help='Port number')
    p_dashboard.set_defaults(func=cmd_dashboard)

    # status command
    p_status = subparsers.add_parser('status', help='Show system status')
    p_status.set_defaults(func=cmd_status)

    # kill-switch command
    p_kill = subparsers.add_parser('kill-switch', help='Manage kill switch')
    p_kill.add_argument('--arm', action='store_true', help='Arm kill switch')
    p_kill.add_argument('--disarm', action='store_true', help='Disarm kill switch')
    p_kill.add_argument('--trigger', '-t', help='Trigger with reason')
    p_kill.add_argument('--details', '-d', help='Trigger details')
    p_kill.add_argument('--reset', action='store_true', help='Reset kill switch')
    p_kill.set_defaults(func=cmd_kill_switch)

    # swarm command
    p_swarm = subparsers.add_parser('swarm', help='Manage swarm')
    p_swarm.add_argument('--status', action='store_true', help='Show swarm status')
    p_swarm.add_argument('--task', '-t', help='Execute a task')
    p_swarm.set_defaults(func=cmd_swarm)

    # tui command
    p_tui = subparsers.add_parser('tui', help='Launch terminal interface')
    p_tui.set_defaults(func=cmd_tui)

    # telegram command
    p_telegram = subparsers.add_parser('telegram', help='Start Telegram bot')
    p_telegram.add_argument('--token', '-t', help='Bot token (or set TELEGRAM_BOT_TOKEN)')
    p_telegram.add_argument('--chat-id', '-c', help='Chat ID for notifications')
    p_telegram.set_defaults(func=cmd_telegram)

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        return

    if hasattr(args, 'func'):
        args.func(args)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
