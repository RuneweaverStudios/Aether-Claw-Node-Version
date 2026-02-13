# TUI Input Fixes - Summary

## Problem
TUI was exiting immediately after showing the prompt with "Goodbye!" message. This happened because stdin was getting EOFError when trying to read input.

## Root Cause
1. When launched via subprocess from onboarding, stdin might not be a TTY
2. Rich's `Prompt.ask()` doesn't handle non-TTY stdin well
3. `/dev/tty` might not be available in all environments
4. Need fallback chain for input reading

## Solution Implemented

### 1. Inline Input Reading
Replaced Rich's `Prompt.ask()` with inline input reading that:
- First tries `/dev/tty` (works in real terminals)
- Falls back to `sys.stdin.readline()` if `/dev/tty` unavailable
- Falls back to Python's `input()` as last resort
- Provides clear error messages if all methods fail

### 2. Improved Error Handling
- Shows helpful error messages instead of just "Goodbye!"
- Explains that TUI requires an interactive terminal
- Suggests running directly: `python3 tui.py`

### 3. Stdin Preservation
- Updated `cmd_tui()` to explicitly preserve stdin/stdout/stderr
- Matches the onboarding launch method
- Ensures stdin is properly connected

## Code Changes

### tui.py
- Removed `safe_input()` function (replaced with inline code)
- Added inline input reading in main loop
- Improved error messages
- Better handling of non-TTY stdin

### aether_claw.py
- Updated `cmd_tui()` to preserve stdin/stdout/stderr
- Matches onboarding launch method

## Testing

Run these tests to verify:

1. **Direct launch** (should work):
   ```bash
   python3 tui.py
   ```

2. **Via subprocess** (should work):
   ```bash
   python3 -c "import subprocess; import sys; subprocess.run(['python3', 'tui.py'], stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr)"
   ```

3. **Via onboarding** (should work):
   ```bash
   python3 aether_claw.py onboard
   # Then select option 1
   ```

## Expected Behavior

After fixes:
- TUI should detect and use `/dev/tty` when available
- TUI should fallback to stdin if `/dev/tty` unavailable
- TUI should show helpful error messages if input fails
- TUI should NOT exit immediately on launch
- TUI should work when launched from onboarding

## If Still Failing

1. Check terminal: `test -r /dev/tty && echo "OK" || echo "FAIL"`
2. Check stdin: `python3 -c "import sys; print(sys.stdin.isatty())"`
3. Try direct launch: `python3 tui.py`
4. Check Python version: `python3 --version` (needs 3.11+)
5. Check Rich version: `python3 -c "import rich; print(rich.__version__)"`

## Files Modified
- `tui.py` - Input handling improvements
- `aether_claw.py` - Stdin preservation in cmd_tui()
- `test_tui_input.py` - Diagnostic test script
- `test_tui_simple.py` - Simple input test
- `TUI_TROUBLESHOOTING.md` - Troubleshooting guide
