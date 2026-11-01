# Android access (private test)

## Why there is no APK yet

This computer does not have the Android SDK, Java JDK, Gradle or ADB installed. Building a signed Capacitor APK would require installing those tools (hundreds of MB) and a keystore. That was not done.

When the SDK is available later:

1. `npm install @capacitor/core @capacitor/cli @capacitor/android` inside `ASH-AI-PLATFORM` (or a thin wrapper folder).
2. Point Capacitor `server.url` at the **hosted HTTPS** origin, not `127.0.0.1`.
3. `npx cap add android` then produce a debug/test APK. Do not publish to Google Play.

Target APK size is 30–40 MB because the web UI is reused and no model weights are bundled.

## What works now on a phone

Install ASH Chat as a **PWA** from Chrome:

- Same Wi-Fi as the PC: `npm.cmd run lan-https` then open `https://PC-WIFI-ADDRESS:3443` and Add to Home screen.
- After cloud hosting exists: open the HTTPS site and install from the browser.

Sign in with the same email and password used on the computer. Conversations and projects are stored on the shared backend, not inside the phone app.
