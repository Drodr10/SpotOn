import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useCallback } from "react";
import { View } from "react-native";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SwitzerLight: require("../../assets/fonts/Switzer-Light.otf"),
    SwitzerSemibold: require("../../assets/fonts/Switzer-Semibold.otf"),
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="QuickSearch" />
        <Stack.Screen name="Homescreen" />
        <Stack.Screen name="search" />
        <Stack.Screen name="CreateListing" />
        <Stack.Screen name="CreateListing2" />
      </Stack>
      <StatusBar style="auto" />
    </View>
  );
}
