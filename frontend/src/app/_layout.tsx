import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import MenuBar from "../components/MenuBar";
import { supabase } from "../utils/supabase";
import { registerForPushNotifications } from "../utils/push";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SwitzerLight: require("../../assets/fonts/Switzer-Light.otf"),
    SwitzerSemibold: require("../../assets/fonts/Switzer-Semibold.otf"),
    SwitzerSemiboldItalic: require("../../assets/fonts/Switzer-SemiboldItalic.otf"),
    BevellierMedium: require("../../assets/fonts/Bevellier-Medium.otf"),
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Register for push (payout notifications) whenever a session is active.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) registerForPushNotifications();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) registerForPushNotifications();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <View style={{ flex: 1, position: "relative" }}>
          <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="Intro" />
            <Stack.Screen name="SignIn" />
            <Stack.Screen name="Onboarding" />
            <Stack.Screen name="QuickSearch" />
            <Stack.Screen name="Homescreen" />
            <Stack.Screen name="search" />
            <Stack.Screen name="CreateListing" />
            <Stack.Screen name="CreateListing2" />
            <Stack.Screen name="Messages" />
            <Stack.Screen name="Chat" />
            <Stack.Screen name="Profile" />
            <Stack.Screen name="RegisterVehicle" />
            <Stack.Screen name="PreviousReservations" />
            <Stack.Screen name="YourSpots" />
          </Stack>
          <MenuBar />
        </View>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
