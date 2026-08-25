// Dynamic Expo config.
//
// app.json stays the source of truth for everything static — this file only
// injects the one value that must not be committed. The repo is public and
// app.json is tracked, so the Android Maps key is read from the environment
// (frontend/.env, gitignored) instead of living in the config.
//
// Expo loads .env for the CLI process itself, so app.config.js — which runs in
// Node at prebuild — can read any variable via process.env. Only EXPO_PUBLIC_*
// vars are inlined into the client bundle, which is why this one has no such
// prefix: it is consumed by the build, not by app code at runtime.
//
// Re-run `npx expo prebuild` after changing the key. frontend/android/ is
// gitignored, so AndroidManifest.xml is regenerated rather than committed.
//
// iOS intentionally gets no key: there is no PROVIDER_GOOGLE in the app, so
// MapView falls back to Apple Maps on iOS.
//
// Note for EAS Build: .env files are not uploaded, so the key must be set as an
// EAS environment variable there.

const app = require('./app.json');

module.exports = {
  ...app.expo,
  android: {
    ...app.expo.android,
    config: {
      ...app.expo.android?.config,
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
      },
    },
  },
};
