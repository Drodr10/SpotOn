/**
 * index.tsx — App entry point.
 * Sends a signed-in user to QuickSearch and everyone else to the Intro
 * (Sign Up / Sign In) screen. "Signed in" comes from the session persisted on
 * the device, so launching without a connection doesn't look like a sign-out
 * (see utils/authLaunch.ts).
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';

import { hasPersistedSession } from '../utils/authLaunch';

export default function Index() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    hasPersistedSession().then((yes) => {
      if (alive) setSignedIn(yes);
    });
    return () => {
      alive = false;
    };
  }, []);

  // A local storage read: resolves within a frame or two. Render a blank page
  // until then instead of flashing the Intro screen at a signed-in user.
  if (signedIn === null) return <View style={{ flex: 1, backgroundColor: '#DCDBD8' }} />;
  return <Redirect href={signedIn ? '/QuickSearch' : '/Intro'} />;
}
