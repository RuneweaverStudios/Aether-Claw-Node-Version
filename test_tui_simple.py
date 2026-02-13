#!/usr/bin/env python3
"""
Simple test to verify TUI input works.
"""

import sys

def test_input_methods():
    """Test different input methods."""
    print("Testing input methods...")
    print()
    
    # Test 1: Regular input
    print("Test 1: Regular input()")
    try:
        print("Type something: ", end='', flush=True)
        line = input()
        print(f"✓ Got: '{line}'")
    except EOFError:
        print("✗ EOFError")
    except Exception as e:
        print(f"✗ Error: {e}")
    
    print()
    
    # Test 2: stdin.readline()
    print("Test 2: sys.stdin.readline()")
    try:
        print("Type something: ", end='', flush=True)
        line = sys.stdin.readline()
        print(f"✓ Got: '{line.strip()}'")
    except EOFError:
        print("✗ EOFError")
    except Exception as e:
        print(f"✗ Error: {e}")
    
    print()
    
    # Test 3: /dev/tty
    print("Test 3: /dev/tty")
    try:
        with open('/dev/tty', 'r') as tty:
            print("Type something: ", end='', flush=True)
            line = tty.readline()
            print(f"✓ Got: '{line.strip()}'")
    except Exception as e:
        print(f"✗ Error: {e}")

if __name__ == "__main__":
    test_input_methods()
