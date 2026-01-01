# VHS Demo Tape for testingbotctl
# Generate: vhs demo.tape
# Requires: vhs (https://github.com/charmbracelet/vhs)

# Terminal settings
Output demo.gif
Set FontSize 14
Set Width 1400
Set Height 750
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 30ms
Set Shell bash
Set WindowBar Colorful
Set CursorBlink false

# Setup PATH to include current directory (hidden from recording)
Hide
Type "export PATH=.:$PATH"
Enter
Type "clear"
Enter
Show
Sleep 100ms

# ============================================
# INTRO
# ============================================
Sleep 400ms

Type "# TestingBot CLI - Run mobile tests on real devices in the cloud"
Enter
Sleep 0.5s

# ============================================
# MAESTRO DEMO
# ============================================
Type "clear"
Enter
Sleep 300ms

Type "# Run Maestro UI tests on a Pixel 9 Android device"
Enter
Sleep 500ms

Type "testingbot maestro ./app-debug.apk ./flows/ --device Pixel9 --real-device"
Enter

# Wait for script to complete
Sleep 6s

# ============================================
# OUTRO
# ============================================
Sleep 500ms
Type "# View full results at https://testingbot.com/members"
Enter
Sleep 2s
