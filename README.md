# NovelShelf

A fast, lightweight, dark-glass novel tracking app for Android powered by an optimized WebView with ColorOS 17-inspired Living Flow design.

## Architecture & Design System

### ColorOS 17 "Living Flow" Dark Glass UI
- **Dark Theme Only**: Engineered exclusively for dark OLED surfaces (`#0b0e14`). No light theme, no theme toggles, native `color-scheme: dark`.
- **Restrained Backdrop Surfaces**: Persistent `backdrop-filter` is strictly capped to fixed chrome layers: header, floating pill nav, split add button, progressive edge blur overlays, modal scrim, confirm card, and toast. Cards and scrolling content use GPU-accelerated solid tokens to guarantee 120Hz frame rates.
- **Progressive Edge Blur**: Two fixed overlays (`.edge-blur-top` and `.edge-blur-bottom`) with `backdrop-filter: blur(12px)` and masked linear gradients provide progressive feathering without nesting blur inside scroll containers.
- **Physics-Driven Motion Foundation (`www/motion.js`)**: Damped harmonic oscillator solver (`createSpring`) evaluating in <0.4 µs per frame.
- **Delegated Pointer Squish**: 60ms stillness threshold on cards to prevent scroll interference; aspect-ratio dependent compression (0.96 scaleX / 0.92 scaleY) on wide buttons; directional rubber-band offset.
- **Fluid View Transitions**: Seamless page transitions via the View Transitions API (`showScreen`): directional horizontal slides between root tabs (Shelf <-> Stats <-> Backup), shared-element cover morphing on card click, and sheet slide-up for forms.
- **Tactile Haptic Feedback**: Native bridge to Android `HapticFeedbackConstants.CONFIRM` and `KEYBOARD_TAP` with vibration fallback.
- **Stats Dashboard Motion**: Staggered card and section entrances, eased number count-ups (`Motion.countUp` <=900ms), and GPU `transform: scaleX`/`scaleY` bar growth.
- **Reduce Effects Mode**: One-tap toggle in the Backup tab and system `prefers-reduced-motion` support that instantly eliminates blurs, simplifies shadows, disables transitions, and falls back to clean solid surfaces.

## Development & Build Workflow

NovelShelf uses a single-command script to keep web assets in sync with the Android project, execute unit tests, perform syntax validation, and verify zero drift.

### Sync & Verification Script

Run the verification pipeline at any time:

```powershell
.\scripts\sync.ps1
```

This performs:
1. **Asset Synchronization**: Copies `www/` to `android/app/src/main/assets/www/` (excluding unit tests).
2. **Unit Tests**: Executes the complete stats calculator & data test suite (`node www/tests/stats.test.js`).
3. **Syntax Validation**: Runs `node --check` against all JavaScript files.
4. **Drift Verification**: Verifies 100% byte-for-byte synchronization between `www` and `android/app/src/main/assets/www`.

### Building the APK

To sync, verify, and compile the debug APK in one command:

```powershell
.\scripts\sync.ps1 -Build
```

The APK will be generated at `android/app/build/outputs/apk/debug/app-debug.apk`.
