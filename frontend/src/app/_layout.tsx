import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useCallback } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import MenuBar from "../components/MenuBar";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SwitzerLight: require("../../assets/fonts/Switzer-Light.otf"),
    SwitzerSemibold: require("../../assets/fonts/Switzer-Semibold.otf"),
    BevellierMedium: require("../../assets/fonts/Bevellier-Medium.otf"),
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
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <View style={{ flex: 1, position: "relative" }}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="QuickSearch" />
            <Stack.Screen
              name="Homescreen"
              options={({ route }: any) => ({
                animation: (route.params as any)?.animation ?? "slide_from_right",
              })}
            />
            <Stack.Screen name="search" />
            <Stack.Screen name="CreateListing" />
            <Stack.Screen
              name="CreateListing2"
              options={({ route }: any) => ({
                animation: (route.params as any)?.animation ?? "slide_from_right",
              })}
            />
            <Stack.Screen
              name="Messages"
              options={({ route }: any) => ({
                animation: (route.params as any)?.animation ?? "slide_from_right",
              })}
            />
            <Stack.Screen name="Chat" />
            <Stack.Screen
              name="Profile"
              options={({ route }: any) => ({
                animation: (route.params as any)?.animation ?? "slide_from_right",
              })}
            />
          </Stack>
          <MenuBar />
        </View>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
