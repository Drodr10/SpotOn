# SpotOn Frontend

Expo (React Native) app for SpotOn. Uses [Expo Router](https://docs.expo.dev/router/introduction/) for file-based routing.

## How to run

1. **Install dependencies** (from the `frontend` folder):

   ```bash
   npm install
   ```

2. **Start the dev server**:

   ```bash
   npm start
   ```

   Or:

   ```bash
   npx expo start
   ```

3. **Open the app**:
   - Press **i** for iOS simulator  
   - Press **a** for Android emulator  
   - Press **w** for web  
   - Or scan the QR code with [Expo Go](https://expo.dev/go) on your device  

## Other scripts

| Command           | Description                    |
|-------------------|--------------------------------|
| `npm run ios`     | Start and open iOS simulator   |
| `npm run android` | Start and open Android emulator|
| `npm run web`     | Start and open in browser      |
| `npm run lint`    | Run ESLint                     |

## Prerequisites

- **Node.js** (LTS recommended)
- **iOS**: Xcode and iOS Simulator (macOS)
- **Android**: Android Studio and an emulator or device with USB debugging
- **Expo Go**: optional, for running on a physical device without a full native build

## Project structure

- `src/app/` — Screens (file-based routes): `Intro.tsx`, `Homescreen.tsx`, `search.tsx`, etc.
- `src/components/` — Reusable UI components
- `src/constants/` — Theme, fonts, shared config
- `assets/` — Images and other static assets
