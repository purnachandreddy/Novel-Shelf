# NovelShelf

A fast, lightweight, dark-glass novel tracking app for Android powered by an optimized WebView with ColorOS 17-inspired Living Flow design.

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
