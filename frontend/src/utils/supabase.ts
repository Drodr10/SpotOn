import "expo-sqlite/localStorage/install";
import { createClient, processLock } from "@supabase/supabase-js";

import { AppState, Platform } from "react-native"; 


// The expo docs say that its okay to put the keys and url as an object literal since supabase has
// RLS, but its probably better to just have it stored in an env regardless.

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "nulled";
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "nulled";

//To use this:
// import { supabase } from "../utils/supabase";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        lock: processLock,
    }
});


if (Platform.OS !== "web") {
    AppState.addEventListener("change", (state) => {
        if (state === "active") {
            supabase.auth.startAutoRefresh();
        }
        else {
            supabase.auth.stopAutoRefresh();
        }
    });
};
