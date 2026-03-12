import "expo-sqlite/localStorage/install";
import { createClient } from "@supabase/supabase-js";

// The expo docs say that its okay to put the keys and url as an object literal since supabase has
// RLS, but its probably better to just have it stored in an env regardless.

const supabaseUrl = process.env.EXPO_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_SUPABASE_PUBLISHABLE_KEY;np

//To use this:
// import { supabase } from "../utils/supabase";

createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
    }
});

