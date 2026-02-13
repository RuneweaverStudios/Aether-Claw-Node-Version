#!/usr/bin/env python3
"""
Aether-Claw Terminal TUI

Interactive terminal interface with chat, status, and task management.
"""

import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Prompt
    from rich.table import Table
    from rich.live import Live
    from rich.layout import Layout
    from rich.markdown import Markdown
    from rich.text import Text
except ImportError:
    print("Installing rich...")
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "rich"])
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Prompt
    from rich.table import Table
    from rich.live import Live
    from rich.layout import Layout
    from rich.markdown import Markdown
    from rich.text import Text

console = Console()

# Chat history
chat_history: list[dict] = []


def load_api_client():
    """Load the GLM client with API key."""
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / '.env')

    from glm_client import GLMClient, ModelTier
    return GLMClient(), ModelTier


def get_system_status() -> dict:
    """Get current system status."""
    try:
        from config_loader import load_config
        from brain_index import BrainIndexer
        from safe_skill_creator import SafeSkillCreator

        config = load_config()
        indexer = BrainIndexer()
        stats = indexer.get_stats()
        creator = SafeSkillCreator()
        skills = creator.list_skills()

        return {
            "version": config.version,
            "indexed_files": stats['total_files'],
            "total_versions": stats['total_versions'],
            "skills": len(skills),
            "valid_skills": sum(1 for s in skills if s.get('signature_valid')),
            "heartbeat": config.heartbeat.enabled,
            "safety_gate": config.safety_gate.enabled,
        }
    except Exception as e:
        return {"error": str(e)}


def render_header() -> Panel:
    """Render the header panel."""
    header_text = f"""[bold cyan]A E T H E R C L A W[/] [dim]v1.0.0[/] [green]{datetime.now().strftime("%H:%M:%S")}[/]"""
    return Panel(header_text, style="cyan", height=3)


def render_banner():
    """Render full ASCII banner."""
    console.print()
    console.print("[bold blue]╔════════════════════════════════════════════════════╗[/]")
    console.print("[bold blue]║[/] [bold cyan]                A E T H E R C L A W                 [/] [bold blue]║[/]")
    console.print("[bold blue]║[/] [dim]  ───────────────────────────────────────────────  [/][bold blue]║[/]")
    console.print("[bold blue]║[/] [white]     Secure Swarm-Based Second Brain / Agent        [/][bold blue]║[/]")
    console.print("[bold blue]║[/] [dim]  Local • Cryptographically Signed Skills • Memory  [/][bold blue]║[/]")
    console.print("[bold blue]╚════════════════════════════════════════════════════╝[/]")
    console.print()
    console.print("""[cyan]   █████╗ ███████╗████████╗██╗  ██╗███████╗██████╗
  ██╔══██╗██╔════╝╚══██╔══╝██║  ██║██╔════╝██╔══██╗
  ███████║█████╗     ██║   ███████║█████╗  ██████╔╝
  ██╔══██║██╔══╝     ██║   ██╔══██║██╔══╝  ██╔══██╗
  ██║  ██║███████╗   ██║   ██║  ██║███████╗██║  ██║
  ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝[/]""")
    console.print()


def render_status() -> Panel:
    """Render status panel."""
    status = get_system_status()

    if "error" in status:
        return Panel(f"[red]Error: {status['error']}[/]", title="Status", style="red")

    content = Text()
    content.append(f"Memory: {status['indexed_files']} files ", style="green")
    content.append(f"| Skills: {status['valid_skills']}/{status['skills']} ", style="yellow")
    content.append(f"| Safety: {'ON' if status['safety_gate'] else 'OFF'}", style="cyan")

    return Panel(content, title="System Status", style="blue")


def render_chat() -> Panel:
    """Render chat history panel."""
    if not chat_history:
        content = "[dim]No messages yet. Type a message to start chatting.[/]"
    else:
        lines = []
        for msg in chat_history[-10:]:  # Last 10 messages
            role = msg["role"]
            content = msg["content"]
            timestamp = msg.get("timestamp", "")

            if role == "user":
                lines.append(f"[bold blue]You[/] [{timestamp}]:")
                lines.append(f"  {content}")
            else:
                lines.append(f"[bold green]Aether-Claw[/] [{timestamp}]:")
                lines.append(f"  {content[:500]}{'...' if len(content) > 500 else ''}")
            lines.append("")

        content = "\n".join(lines)

    return Panel(content, title="Chat", style="green")


def render_help() -> Panel:
    """Render help panel."""
    help_text = """[bold]Commands:[/]
  [cyan]/status[/]     - Show detailed system status
  [cyan]/heartbeat[/]  - Run heartbeat tasks once
  [cyan]/skills[/]     - List signed skills
  [cyan]/memory[/]     - Search memory
  [cyan]/clear[/]      - Clear chat history
  [cyan]/help[/]       - Show this help
  [cyan]/quit[/]       - Exit TUI

[bold]Chat:[/] Type any message to interact with the AI agent."""

    return Panel(help_text, title="Help", style="yellow")


def cmd_status():
    """Show detailed status."""
    console.clear()
    console.print(render_header())
    console.print()

    status = get_system_status()

    table = Table(title="System Status", show_header=False)
    table.add_column("Key", style="cyan")
    table.add_column("Value", style="green")

    for key, value in status.items():
        table.add_row(key.replace("_", " ").title(), str(value))

    console.print(table)
    console.print()
    Prompt.ask("[dim]Press Enter to continue[/]")


def cmd_heartbeat():
    """Run heartbeat once."""
    console.print("[yellow]Running heartbeat tasks...[/]")

    try:
        from heartbeat_daemon import HeartbeatDaemon
        daemon = HeartbeatDaemon()
        results = daemon.run_once()

        for result in results:
            status = "[green]OK[/]" if result.success else "[red]FAILED[/]"
            console.print(f"  {status} {result.task_name}: {result.message}")

        console.print("[green]Heartbeat complete.[/]")
    except Exception as e:
        console.print(f"[red]Error: {e}[/]")

    Prompt.ask("[dim]Press Enter to continue[/]")


def cmd_skills():
    """List skills."""
    try:
        from safe_skill_creator import SafeSkillCreator
        creator = SafeSkillCreator()
        skills = creator.list_skills()

        table = Table(title="Signed Skills")
        table.add_column("Name", style="cyan")
        table.add_column("Status", style="green")
        table.add_column("Created")

        for skill in skills:
            status = "[green]VALID[/]" if skill.get('signature_valid') else "[red]INVALID[/]"
            created = skill.get('metadata', {}).get('created_at', 'N/A')
            table.add_row(skill['name'], status, created[:10] if created else 'N/A')

        console.print(table)
    except Exception as e:
        console.print(f"[red]Error: {e}[/]")

    Prompt.ask("[dim]Press Enter to continue[/]")


def cmd_memory(query: str):
    """Search memory."""
    try:
        from brain_index import BrainIndexer
        indexer = BrainIndexer()
        results = indexer.search_memory(query, limit=5)

        if results:
            console.print(f"\n[yellow]Found {len(results)} results:[/]\n")
            for r in results:
                console.print(f"[cyan]{r['file_name']}[/]")
                content = r.get('content', '')[:200]
                console.print(f"  {content}...\n")
        else:
            console.print("[dim]No results found.[/]")
    except Exception as e:
        console.print(f"[red]Error: {e}[/]")

    Prompt.ask("[dim]Press Enter to continue[/]")


def send_message(message: str) -> str:
    """Send message to AI and get response."""
    global chat_history

    # Add user message
    chat_history.append({
        "role": "user",
        "content": message,
        "timestamp": datetime.now().strftime("%H:%M:%S")
    })

    try:
        client, ModelTier = load_api_client()

        # Build context from recent history
        messages = []
        for msg in chat_history[-10:]:
            messages.append({
                "role": msg["role"],
                "content": msg["content"]
            })

        # Add system prompt
        system = """You are Aether-Claw, a secure, swarm-based AI assistant.
You have persistent memory, can run scheduled tasks, and manage signed skills.
Be helpful, concise, and security-conscious.
Respond in plain text (not markdown code blocks unless showing code)."""

        response = client.call(
            prompt=message,
            tier=ModelTier.TIER_1_REASONING,
            system_prompt=system
        )

        if response.success:
            reply = response.content
        else:
            reply = f"Error: {response.error}"

    except Exception as e:
        reply = f"Error connecting to AI: {e}"

    # Add assistant response
    chat_history.append({
        "role": "assistant",
        "content": reply,
        "timestamp": datetime.now().strftime("%H:%M:%S")
    })

    return reply


def main():
    """Main TUI loop."""
    # Check stdin status and try to ensure we have a working input source
    stdin_isatty = False
    tty_available = False
    
    try:
        stdin_isatty = sys.stdin.isatty()
    except Exception:
        pass
    
    # Check if /dev/tty is available
    try:
        with open('/dev/tty', 'r') as f:
            tty_available = True
    except (OSError, IOError):
        tty_available = False
    
    # If stdin is not a TTY and /dev/tty is available, prefer /dev/tty
    # Input reading is handled inline in the main loop
    if not stdin_isatty and not tty_available:
        console.print("[yellow]Warning: No interactive terminal available.[/]")
        console.print("[yellow]TUI requires an interactive terminal to function.[/]")
        console.print("[dim]If running via SSH, use: ssh -t user@host[/]")
        console.print()

    console.clear()

    # Show welcome banner
    render_banner()
    
    # Check if first run and run personality setup
    try:
        from personality_setup import is_first_run, run_personality_setup
        
        if is_first_run():
            # Run OpenClaw-style personality setup
            if run_personality_setup():
                console.print("[dim]Type /help for commands, or start chatting[/]")
                console.print()
        else:
            console.print("[dim]Type /help for commands, or start chatting[/]")
            console.print()
    except ImportError:
        # personality_setup not available, skip
        console.print("[dim]Type /help for commands, or start chatting[/]")
        console.print()
    except Exception as e:
        # Setup failed, continue anyway
        console.print(f"[yellow]Note: Could not run personality setup: {e}[/]")
        console.print("[dim]Type /help for commands, or start chatting[/]")
        console.print()

    while True:
        try:
            # Render current state
            console.print(render_status())
            console.print()

            # Show recent chat
            if chat_history:
                last = chat_history[-1]
                if last["role"] == "assistant":
                    console.print(Panel(
                        last["content"][:1000],
                        title="[green]Aether-Claw[/]",
                        style="green"
                    ))
                else:
                    console.print(Panel(
                        last["content"],
                        title="[blue]You[/]",
                        style="blue"
                    ))

            # Get input using safe method
            console.print()
            try:
                # Print styled prompt with Rich
                console.print("[bold cyan]>[/] ", end='')
                sys.stdout.flush()
                
                # Try to read input - prefer /dev/tty, fallback to stdin
                user_input = None
                
                # First try /dev/tty (always works in real terminals)
                try:
                    with open('/dev/tty', 'r') as tty_file:
                        user_input = tty_file.readline().strip()
                except (OSError, IOError):
                    # /dev/tty not available, try stdin
                    try:
                        # Check if stdin is readable
                        if not sys.stdin.closed:
                            user_input = sys.stdin.readline().strip()
                        else:
                            raise EOFError("stdin is closed")
                    except (EOFError, OSError, IOError):
                        # stdin also failed, try input() as last resort
                        try:
                            user_input = input().strip()
                        except EOFError:
                            raise EOFError("Cannot read from stdin")
                
                if not user_input:
                    continue  # Empty input, loop again
                    
            except EOFError as e:
                console.print(f"\n[yellow]Input stream closed: {e}[/]")
                console.print("[yellow]TUI requires an interactive terminal.[/]")
                console.print("[dim]Try running directly: python3 tui.py[/]")
                console.print("[yellow]Goodbye![/]")
                break
            except EOFError as e:
                console.print(f"\n[yellow]Input stream closed: {e}[/]")
                console.print("[yellow]TUI requires an interactive terminal.[/]")
                console.print("[dim]Try running directly: python3 tui.py[/]")
                console.print("[yellow]Goodbye![/]")
                break
            except KeyboardInterrupt:
                console.print("\n[yellow]Use /quit to exit[/]")
                continue
            except Exception as e:
                console.print(f"\n[red]Error reading input: {e}[/]")
                console.print("[yellow]TUI requires an interactive terminal.[/]")
                console.print("[yellow]Goodbye![/]")
                break

            if not user_input:
                continue

            # Handle commands
            if user_input.startswith("/"):
                cmd = user_input.lower().split()[0]

                if cmd in ("/quit", "/exit", "/q"):
                    console.print("[yellow]Goodbye![/]")
                    break

                elif cmd == "/help":
                    console.print(render_help())

                elif cmd == "/status":
                    cmd_status()

                elif cmd == "/heartbeat":
                    cmd_heartbeat()

                elif cmd == "/skills":
                    cmd_skills()

                elif cmd == "/clear":
                    chat_history.clear()
                    console.print("[green]Chat cleared.[/]")

                elif cmd == "/memory":
                    parts = user_input.split(maxsplit=1)
                    if len(parts) > 1:
                        cmd_memory(parts[1])
                    else:
                        console.print("[yellow]Usage: /memory <query>[/]")

                else:
                    console.print(f"[red]Unknown command: {cmd}[/]")
                    console.print("[dim]Type /help for available commands[/]")

            else:
                # Send to AI
                console.print("[dim]Thinking...[/]")
                reply = send_message(user_input)
                console.clear()

        except KeyboardInterrupt:
            console.print("\n[yellow]Use /quit to exit[/]")
            continue
        except EOFError:
            console.print("\n[yellow]Input stream closed. Goodbye![/]")
            break
        except Exception as e:
            console.print(f"\n[red]Unexpected error: {e}[/]")
            console.print("[yellow]Goodbye![/]")
            break


if __name__ == "__main__":
    main()
