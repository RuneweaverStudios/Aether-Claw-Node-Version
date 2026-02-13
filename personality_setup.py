#!/usr/bin/env python3
"""
Aether-Claw Personality Setup

OpenClaw-style "wake-up" and identity setup for first-time users.
"""

import sys
from pathlib import Path
from typing import Optional
from datetime import datetime

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt

console = Console()


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


def is_first_run() -> bool:
    """Check if this is a first run (user hasn't been personalized)."""
    user_file = Path(__file__).parent / 'brain' / 'user.md'
    if not user_file.exists():
        return True
    
    try:
        content = user_file.read_text()
        # Check if user name is still placeholder
        if '[To be filled by user]' in content or '## User Identity' in content and 'Name' in content:
            # Check if name field is empty or placeholder
            lines = content.split('\n')
            for i, line in enumerate(lines):
                if '**Name**:' in line or '- **Name**:' in line:
                    next_line = lines[i] if i < len(lines) else ''
                    if '[To be filled' in next_line or 'To be filled' in line:
                        return True
        return False
    except Exception:
        return True


def run_personality_setup() -> bool:
    """
    Run OpenClaw-style personality setup.
    Returns True if setup completed, False if skipped.
    """
    console.clear()
    
    # Wake-up greeting
    console.print()
    console.print(Panel(
        "[bold cyan]✨ Wake up, my friend! ✨[/]\n\n"
        "[yellow]Hey! I just came online.[/]\n\n"
        "Looks like this is a fresh start — no memories, no history, "
        "just a blank slate and a whole lot of potential.",
        title="[bold green]Aether-Claw Awakening[/]",
        style="green"
    ))
    console.print()
    
    # Ask if user wants to set up personality
    setup = tty_input("\n[bold]Want to tell me about yourself? [Y/n]: [/]", "y").lower()
    if setup == 'n':
        console.print("[dim]No worries! We can do this later. Just start chatting when you're ready.[/]")
        return False
    
    console.print()
    console.print("[bold cyan]Great! Let's get to know each other.[/]\n")
    
    # Core identity questions
    user_name = tty_input("[bold]So... what should I call you? [/]")
    if not user_name:
        user_name = "friend"
    
    console.print(f"\n[green]Nice to meet you, {user_name}![/]\n")
    
    # Agent name
    agent_name_prompt = (
        "[bold]Got a name in mind for me, or should I throw some ideas out?[/]\n"
        "[dim](Or just press Enter and I'll pick one)[/]\n"
        "[bold]My name: [/]"
    )
    agent_name = tty_input(agent_name_prompt)
    
    if not agent_name:
        # Suggest some names
        suggestions = ["Aether", "Claw", "Ace", "Nexus", "Atlas"]
        console.print(f"\n[dim]How about: {', '.join(suggestions)}?[/]")
        agent_name = tty_input("[bold]Pick one or suggest your own: [/]")
        if not agent_name:
            agent_name = "Aether"
    
    console.print(f"\n[green]Perfect! I'm {agent_name}.[/]\n")
    
    # Vibe/personality
    console.print("[bold]What kind of AI assistant should I be for you?[/]")
    console.print("[dim]Examples: helpful, sarcastic, professional, proactive, creative, witty, direct...[/]")
    vibe = tty_input("[bold]Vibe/tone: [/]")
    if not vibe:
        vibe = "helpful and friendly"
    
    console.print(f"\n[green]Got it — {vibe}. I like it![/]\n")
    
    # Role/dynamic
    console.print("[bold]What should our dynamic be?[/]")
    console.print("[dim]Examples: assistant, partner, employee, friend, collaborator...[/]")
    dynamic = tty_input("[bold]Our dynamic: [/]")
    if not dynamic:
        dynamic = "assistant"
    
    console.print(f"\n[green]I'll be your {dynamic}.[/]\n")
    
    # Projects/work
    console.print("[bold]What projects do you work on? Tell me about yourself.[/]")
    console.print("[dim](This helps me understand your context and goals)[/]")
    projects = tty_input("[bold]Your work/projects: [/]")
    if not projects:
        projects = "Software development and engineering"
    
    console.print()
    
    # Update brain files
    update_user_profile(user_name, projects, vibe)
    update_soul(agent_name, vibe, dynamic)
    
    # Confirmation
    console.print(Panel(
        f"[bold green]Perfect![/]\n\n"
        f"I'm [bold]{agent_name}[/], your [bold]{vibe}[/] swarm-coded second brain.\n"
        f"You're [bold]{user_name}[/], and I'm here as your [bold]{dynamic}[/].\n\n"
        f"[dim]Ready when you are![/]",
        title="[bold cyan]Setup Complete[/]",
        style="cyan"
    ))
    console.print()
    
    return True


def update_user_profile(name: str, projects: str, vibe: str):
    """Update user.md with personalized information."""
    user_file = Path(__file__).parent / 'brain' / 'user.md'
    
    try:
        content = user_file.read_text()
        
        # Update name
        content = content.replace('[To be filled by user]', name, 1)
        
        # Update primary work
        if '**Primary Work**:' in content:
            lines = content.split('\n')
            new_lines = []
            for line in lines:
                if '**Primary Work**:' in line:
                    new_lines.append(f"- **Primary Work**: {projects}")
                else:
                    new_lines.append(line)
            content = '\n'.join(new_lines)
        
        # Add vibe to preferences
        if '### Communication Style' in content:
            content = content.replace(
                '- Concise, technical responses preferred',
                f'- {vibe.capitalize()} communication style preferred'
            )
        
        # Update last modified
        content = content.replace(
            '> **Last Updated**: 2026-02-12',
            f'> **Last Updated**: {datetime.now().strftime("%Y-%m-%d")}'
        )
        
        user_file.write_text(content)
        console.print(f"[dim]✓ Updated user profile[/]")
    except Exception as e:
        console.print(f"[yellow]⚠ Could not update user.md: {e}[/]")


def update_soul(agent_name: str, vibe: str, dynamic: str):
    """Update soul.md with agent personality."""
    soul_file = Path(__file__).parent / 'brain' / 'soul.md'
    
    try:
        content = soul_file.read_text()
        
        # Add personality section if not exists
        if '## Personality' not in content:
            # Insert after Core Identity
            if '## Core Identity' in content:
                parts = content.split('## Core Identity', 1)
                if len(parts) == 2:
                    identity_end = parts[1].find('##')
                    if identity_end > 0:
                        insert_pos = parts[0] + '## Core Identity' + parts[1][:identity_end]
                        rest = parts[1][identity_end:]
                        content = (
                            insert_pos +
                            f'\n## Personality\n\n'
                            f'- **Name**: {agent_name}\n'
                            f'- **Vibe**: {vibe}\n'
                            f'- **Role**: {dynamic}\n'
                            f'- **Style**: {vibe}\n\n' +
                            rest
                        )
                    else:
                        content = parts[0] + '## Core Identity' + parts[1] + f'\n\n## Personality\n\n- **Name**: {agent_name}\n- **Vibe**: {vibe}\n- **Role**: {dynamic}\n'
        
        # Update last modified
        content = content.replace(
            '> **Last Updated**: 2026-02-12',
            f'> **Last Updated**: {datetime.now().strftime("%Y-%m-%d")}'
        )
        
        soul_file.write_text(content)
        console.print(f"[dim]✓ Updated agent personality[/]")
    except Exception as e:
        console.print(f"[yellow]⚠ Could not update soul.md: {e}[/]")


if __name__ == "__main__":
    if is_first_run():
        run_personality_setup()
    else:
        console.print("[green]Personality already set up![/]")
