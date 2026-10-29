# VHS Demo Tape for testingbotctl - Full Install & Run Demo
# Generate: vhs demo-install.tape
# Requires: vhs (https://github.com/charmbracelet/vhs)

# Terminal settings
Output demo-install.mp4
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

Sleep 0.5s

# ============================================
# INSTALL
# ============================================
Hide
Type "clear"
Enter
Show
Sleep 300ms

Type "# Install the TestingBot CLI"
Enter
Sleep 500ms

Type "npm install -g @testingbot/cli"
Enter

Sleep 3s

# ============================================
# LOGIN
# ============================================
Hide
Type "clear"
Enter
Show
Sleep 300ms

Type "# Login to your TestingBot account"
Enter
Sleep 500ms

Type "testingbot login"
Enter

Sleep 8s

# ============================================
# ANDROID MAESTRO DEMO
# ============================================
Hide
Type "clear"
Enter
Show
Sleep 300ms

Type "# Run Maestro UI tests on a Physical Android Device (Pixel 9)"
Enter
Sleep 500ms

Type "testingbot maestro ./app-debug.apk ./flows/ --device Pixel9 --real-device"
Enter

# Wait for script to complete
Sleep 14s

# ============================================
# iOS MAESTRO DEMO
# ============================================
Hide
Type "clear"
Enter
Show
Sleep 300ms

Type "# Run Maestro UI tests on a Physical iOS Device (iPhone 16)"
Enter
Sleep 500ms

Type "testingbot maestro sample.ipa ./flows --device 'iPhone 16' --real-device"
Enter

# Wait for script to complete
Sleep 7s
