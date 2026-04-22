# KM Tracker

A React Native app built with Expo that tracks how far you have walked or run, with a 1 km challenge mode.

## Features

- **Live distance counter** — real-time progress toward 1 km displayed as a ring gauge
- **Auto-stop at 1 km** — tracking stops automatically when you hit the target
- **Haptic feedback** — device vibrates when 1 km is reached
- **Run timer** — elapsed time shown live, final time displayed on completion
- **Run history** — all completed 1 km runs saved with date and time
- **Personal best** — fastest 1 km highlighted with a gold card
- **Persistent storage** — history survives app restarts via AsyncStorage
- **Screen stays on** — screen lock is suppressed during an active run

## Tech Stack

| Package | Purpose |
|---|---|
| `expo-location` | GPS tracking |
| `expo-haptics` | Vibration on completion |
| `expo-keep-awake` | Prevents screen lock during a run |
| `@react-native-async-storage/async-storage` | Persistent run history |
| `react-native-safe-area-context` | Safe area layout |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Expo Go](https://expo.dev/go) installed on your Android or iOS device

### Install

```bash
git clone https://github.com/HanneAga/km-tracker.git
cd km-tracker
npm install
```

### Run

```bash
npx expo start
```

Scan the QR code with Expo Go. If your phone and computer are on different networks use the tunnel flag:

```bash
npx expo start --tunnel
```

## How to Use

1. Open the app and tap **Start Run**
2. Grant location permission when prompted
3. Walk or run — the ring gauge and distance counter update in real time
4. The app stops automatically at 1 km and vibrates the device
5. Your time is saved to history and compared against your personal best
6. Tap **New Run** to go again
7. To discard a run in progress tap **Stop Early** — this does not save to history
8. Tap **Clear History** at the bottom of the history list to wipe all saved runs

## GPS Accuracy Notes

The app filters out low-quality GPS readings to reduce drift:

- Readings with an accuracy radius greater than 20 m are discarded
- Readings where speed is below 0.3 m/s (roughly standing still) are ignored
- Location updates are only processed after moving at least 3 m

This makes the distance counter more reliable outdoors but means the counter may lag briefly when starting from a standing position.

> **Note:** Background GPS tracking is not supported in Expo Go. The screen is kept awake during a run to prevent the OS from suspending the app.
