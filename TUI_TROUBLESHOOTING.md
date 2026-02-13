# TUI Troubleshooting Guide

## Issue
TUI exits immediately after showing the prompt with "Goodbye!" message.

## Root Cause
The TUI is getting EOFError when trying to read from stdin, likely because:
1. stdin is not a TTY (piped or redirected)
2. stdin is closed/exhausted
3. Rich Prompt.ask() doesn't handle /dev/tty properly

## Tests to Run

### Test 1: Check stdin status
```bash
python3 test_tui_input.py
```

This will show:
- Whether stdin is a TTY
- Whether /dev/tty is accessible
- Which input method works

### Test 2: Direct TUI launch
```bash
python3 tui.py
```

If this works, the issue is with how onboarding launches the TUI.

### Test 3: Test with piped stdin (simulate onboarding)
```bash
echo "" | python3 tui.py
```

This simulates what happens when stdin is piped.

### Test 4: Test subprocess launch
```bash
python3 -c "import subprocess; import sys; subprocess.run(['python3', 'tui.py'], stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr)"
```

## Solutions Implemented

1. **safe_input() function**: Always uses /dev/tty for interactive input
2. **stdin detection**: Checks if stdin is a TTY and reconnects if needed
3. **Better error handling**: Shows specific error messages instead of just "Goodbye!"

## Debugging Steps

1. Run `test_tui_input.py` to see which input methods work
2. Check if `/dev/tty` is accessible: `test -r /dev/tty && echo "OK" || echo "FAIL"`
3. Try launching TUI directly: `python3 tui.py`
4. Check if issue is with subprocess: See Test 4 above

## Expected Behavior

After fixes:
- TUI should detect non-TTY stdin
- TUI should automatically use /dev/tty for input
- TUI should show helpful error messages if input fails
- TUI should not exit immediately

## If Still Failing

Check:
1. Terminal emulator compatibility
2. SSH session (if remote)
3. Shell configuration (zsh/bash)
4. Python version (needs 3.11+)
5. Rich library version

Run with debug output:
```bash
python3 -u tui.py 2>&1 | tee tui_debug.log
```
