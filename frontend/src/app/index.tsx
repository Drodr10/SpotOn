import { Text, View, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { Fonts } from "../constants/theme";

export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={{ fontFamily: Fonts.SwitzerSemibold, fontSize: 48, fontWeight: "600", marginBottom: 8 }}>Hello</Text>
      <Text style={styles.subtext}>Edit src/app/index.tsx to start building.</Text>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={() => router.push("/Homescreen")}
      >
        <Text style={styles.buttonText}>Go to Homescreen</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  text: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 8,
  },
  subtext: {
    fontSize: 16,
    color: "#666",
    marginBottom: 24,
  },
  button: {
    backgroundColor: "#0a7ea4",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
