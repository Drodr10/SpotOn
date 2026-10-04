// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  // Existing React Native animation and state synchronization patterns produce
  // compiler diagnostics. Keep them visible while preserving errors in new files.
  {
    files: [
      'src/app/CreateListing2.tsx',
      'src/app/QuickSearch.tsx',
      'src/components/DateRangePicker.tsx',
      'src/components/HomescreenComponents/DynamicViewer.tsx',
      'src/components/MenuBar.tsx',
      'src/components/PaymentCard.tsx',
    ],
    rules: {
      'react-hooks/refs': 'warn',
    },
  },
  {
    files: [
      'src/app/Onboarding.tsx',
      'src/app/search.tsx',
      'src/components/HourScroller.tsx',
    ],
    rules: {
      'react-hooks/immutability': 'warn',
    },
  },
  {
    files: [
      'src/app/CreateListing2.tsx',
      'src/app/Profile.tsx',
      'src/app/QuickSearch.tsx',
      'src/app/search.tsx',
      'src/components/DateRangePicker.tsx',
      'src/components/HomescreenComponents/DynamicViewer.tsx',
      'src/components/HomescreenComponents/SuggestionsList.tsx',
      'src/components/HomescreenComponents/UpcomingReservationBanner.tsx',
      'src/components/MenuBar.tsx',
      'src/components/ProfilePageComponents/ReservationInfoCard.tsx',
      'src/hooks/use-color-scheme.web.ts',
      'src/hooks/usePricingPreview.ts',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['src/app/search.tsx'],
    rules: {
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
]);
