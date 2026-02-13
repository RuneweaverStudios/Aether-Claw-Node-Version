#!/usr/bin/env python3
"""
Test script to diagnose TUI stdin issues.
Run this to test different input methods.
"""

import sys
import os

def test_stdin_status():
    """Test stdin status."""
    print("=" * 60)
    print("STDIN DIAGNOSTICS")
    print("=" * 60)
    print()
    
    # Test 1: Check if stdin is a TTY
    try:
        isatty = sys.stdin.isatty()
        print(f"✓ sys.stdin.isatty(): {isatty}")
    except Exception as e:
        print(f"✗ sys.stdin.isatty() failed: {e}")
    
    # Test 2: Check if /dev/tty exists and is readable
    try:
        with open('/dev/tty', 'r') as f:
            tty_isatty = f.isatty()
            print(f"✓ /dev/tty isatty(): {tty_isatty}")
    except Exception as e:
        print(f"✗ /dev/tty access failed: {e}")
    
    # Test 3: Try reading from stdin
    print()
    print("Test 3: Reading from sys.stdin")
    try:
        print("Type something and press Enter (or Ctrl+D to simulate EOF):")
        line = input("> ")
        print(f"✓ Read from stdin: '{line}'")
    except EOFError:
        print("✗ EOFError when reading from stdin")
    except Exception as e:
        print(f"✗ Error reading from stdin: {e}")
    
    # Test 4: Try reading from /dev/tty
    print()
    print("Test 4: Reading from /dev/tty")
    try:
        print("Type something and press Enter:")
        with open('/dev/tty', 'r') as tty_file:
            line = tty_file.readline()
            print(f"✓ Read from /dev/tty: '{line.strip()}'")
    except Exception as e:
        print(f"✗ Error reading from /dev/tty: {e}")
    
    # Test 5: Check environment
    print()
    print("Environment variables:")
    print(f"  TERM: {os.environ.get('TERM', 'not set')}")
    print(f"  SSH_CONNECTION: {os.environ.get('SSH_CONNECTION', 'not set')}")
    print(f"  stdin.fileno(): {sys.stdin.fileno() if hasattr(sys.stdin, 'fileno') else 'N/A'}")
    
    print()
    print("=" * 60)
    print("If all tests pass, TUI should work.")
    print("If Test 3 fails but Test 4 works, use /dev/tty in TUI.")
    print("=" * 60)


if __name__ == "__main__":
    test_stdin_status()
