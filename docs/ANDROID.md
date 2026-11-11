# Android access (private test)

## Local release APK

Built 2026-11-10 on this PC. Toolchain is portable and is not on PATH: Temurin 17.0.21 under `%LOCALAPPDATA%\ASH\jdk\jdk-17.0.21+9`, Android command-line tools, platform 35, and build-tools 35.0.0 under `%LOCALAPPDATA%\Android\Sdk`, Gradle 8.11.1 under `%LOCALAPPDATA%\ASH\gradle\gradle-8.11.1`. Flutter and Dart are not installed and are not required.

The wrapper is `android/`. It is a Trusted Web Activity (`androidbrowserhelper` 2.5.0) that opens `https://ash-ai-platform.onrender.com/`. Package `com.ashai.chat`, version name 1.0.0, version code 1, minSdk 26, targetSdk 35. It does not embed model weights or API keys.

Signed release file:

`android/app/build/outputs/apk/release/app-release.apk`

406,351 bytes. SHA-256 `E979E296C1CCD03053D271FC817177C089333119BA30C783168994B5E076432B`. `apksigner verify` accepted the signature. `adb devices` listed no phone or emulator, so installation on a device is still pending. Until `/.well-known/assetlinks.json` is deployed on the hosted site, Chrome opens this wrapper as a Custom Tab and keeps the address bar.

The signing key is `%LOCALAPPDATA%\ASH\keys\ash-chat-release.keystore`, alias `ash-chat`. Passwords are only in `%LOCALAPPDATA%\ASH\keys\keystore.properties`, which `android/app/build.gradle` reads. Both files stay outside Git. Future releases must use that same keystore and alias, then raise `versionCode`. Do not create a second key. Back up the keystore and the properties file before the next release. Do not paste the password into source, chat, or a commit.

`/download.html` records those facts and does not link to a file. Publishing means a GitHub Release asset (or other object storage) and an approved deploy of this page plus asset links. Do not commit the APK. Do not put it on Vercel.

## What works now on a phone

Install ASH Chat as a **PWA** from Chrome:

- Same Wi-Fi as the PC: `npm.cmd run lan-https` then open `https://PC-WIFI-ADDRESS:3443` and Add to Home screen.
- Hosted team preview: open the Render HTTPS site in Chrome and use **Add to Home screen**. A new account needs the invite code. An existing account signs in with email and password.

A physical Android install, camera, PDF, keyboard, and offline pass has not been recorded in this repository. Do not treat the PWA files as proof that a phone has been tested.

Sign in with an account on that same backend. Conversations and projects are stored on the server for that account, not inside the phone app. The installed shell can open offline. Chat, research, uploads, and cloud models need a network. Voice input uses the browser speech service and also needs a network. Speak uses the device speech engine when the browser provides `speechSynthesis`. Neither works offline.
