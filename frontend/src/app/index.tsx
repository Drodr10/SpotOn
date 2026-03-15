/**
 * index.tsx — App entry point.
 * Immediately redirects to the Intro (login) screen on launch.
 */
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/Intro" />;
}
