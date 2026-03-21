// ─── React & React Native ────────────────────────────────────────────────────
import {
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';

// ─── Supabase ───────────────────────────────────────────────────────
import { supabase } from '../utils/supabase'

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth } = Dimensions.get('window');
const AVATAR_SIZE = screenWidth * 0.075;

//─── Assets ───────────────────────────────────────────────────────────────
import logoutImg from '@/assets/images/templogouticon.png'

export default function LogoutButton({}) {

    const onSignOut = async () => {
        await supabase.auth.signOut();
        router.replace('/Intro');
    }

    return (
        <TouchableOpacity onPress={onSignOut}
            style={styles.buttonBody}>
            <Image source={logoutImg}
                style={styles.buttonIcon}
           ></Image>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    buttonBody: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        alignSelf: 'flex-start',
        
    },
    buttonIcon: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: 999,
    }
});