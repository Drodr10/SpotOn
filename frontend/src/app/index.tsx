/**
 * index.tsx — App entry point.
 * Immediately redirects to the Intro (login) screen on launch.
 */

// ─── React ───────────────────────────────────────────────────────────────
import  { useEffect, } from 'react';
import { Redirect, router } from 'expo-router';

// ─── Auth & Supabase ───────────────────────────────────────────────────────────────
import { supabase } from '../utils/supabase';

export default function Index() {

  // Checks for existing session on app launch and navigates to Homescreen if found
  supabase.auth.getClaims().then(({ data }) => {
    if (data) {
      router.replace('/Homescreen');
    }
  });

  return <Redirect href="/Intro" />;
}
