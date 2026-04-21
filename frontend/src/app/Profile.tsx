import { useState, useEffect, useRef } from 'react';
import { router } from 'expo-router';

import { supabase } from '@/src/utils/supabase';
import { JwtPayload } from '@supabase/supabase-js';

import { 
  View, 
  ScrollView, 
  Text, 
  StyleSheet,
  Dimensions,
  SafeAreaView,
  Image,
  TouchableOpacity,
  TextInput,
  Button
} from 'react-native'

import HomePill from '@/src/components/ProfilePageComponents/HomePill';
import EditableProfileCard from '@/src/components/ProfilePageComponents/EditableProfileCard';
import PreviousSpotsList from '@/src/components/HomescreenComponents/PreviousSpotsList'


import logoAsset from '@/assets/images/spotonlogo.png';
import penIcon from '@/assets/images/penicon.png';
import checkIcon from '@/assets/images/checkmarkicon.png';



const { width: screenWidth } = Dimensions.get('window');
const H_PAD          = screenWidth * 0.05;   
const SECTION_GAP    = screenWidth * 0.07;   
const LOGO_SIZE      = screenWidth * 0.12; 
const SECTION_LABEL  = screenWidth * 0.050; 
const TEXT_SIZE      = screenWidth * 0.05; 

type ProfileData = {
  id: string;
  full_name: string;
  email: string;
  rating_avg: number;
  created_at: string;
}

export default function ProfilePage () {
  const [claims, setClaims] = useState<JwtPayload>();
  const [user, setUser] = useState<ProfileData | null>();

  const [name, setName] = useState<string >('');
  const [email, setEmail] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');

  const [editing, setEditing] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const inputArea = useRef<TextInput>(null);

  const editEmail = () => {
    setEditing(!editing);
  };

  useEffect(() => {
    supabase.auth.getClaims().then(async (resp) => {
      const {data, error} = resp;

      if (error || !data) {
        console.log("Error in finding matching user ID: " + (error ? error : "Data error"));
        return;
      }
      setClaims(data.claims);
      const { data: profileData, error: profileError } =  await supabase.from('profiles').select('*').eq('id', data.claims.sub).single();

      if (profileError || !profileData) {
        console.log("Error in retriving user profile data: " + (profileError ? profileError : "Data error"));
        return;
      }

      setUser(profileData);
      setName(profileData.full_name);
      setEmail(profileData.email);
    });
  }, []);

  useEffect(()=> {
    if (editing) inputArea.current?.focus();
  },  [editing]);

  if (!user) return null;

  const saveChanges = async () => {
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    const nameChanged = name !== user.full_name;
    const emailChanged = email !== user.email;

    if (!nameChanged && !emailChanged) {
      setLoading(false);
      router.replace('./Homescreen');
      return;
    }

    if (nameChanged && (name.length > 20 || name.length <= 3)) {
      setErrorMessage('Name must be between 4 and 20 characters.');
      setLoading(false);
      return;
    }

    if (emailChanged) {
      const pattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
      if (!pattern.test(email)) {
        setErrorMessage('Invalid email');
        setLoading(false);
        return;
      }
    }

    const authUpdate: { email?: string; data?: { full_name?: string } } = {};
    const profileUpdate: { full_name?: string; } = {};

    if (nameChanged) {
      authUpdate.data = { full_name: name };
      profileUpdate.full_name = name;
    }
    if (emailChanged) {
      authUpdate.email = email;
    }

    if (Object.keys(authUpdate).length > 0) {
      const { error: authError } = await supabase.auth.updateUser(authUpdate);
      if (authError) {
        setErrorMessage(authError.message);
        setLoading(false);
        return;
      }
    }

    if (Object.keys(profileUpdate).length > 0) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update(profileUpdate)
        .eq('id', user.id);

      if (profileError) {
        setErrorMessage(profileError.message);
        setLoading(false);
        return;
      }
    }

    setLoading(false);

    if (emailChanged) {
      setSuccessMessage(
        'Please check your new email address to confirm the change.'
      );
      if (nameChanged) {
        setUser({ ...user, full_name: name });
      }
    } else {
      router.replace('./Homescreen');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.screen}>
        <View style={styles.header}>
          <HomePill />

          <Image
              source={logoAsset}
              style={styles.logo}
              resizeMode="contain"
            />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Profile Settings</Text>
        </View>

        <View style={styles.section}>
          <EditableProfileCard  name={name!} setName={setName} rating={user.rating_avg}/>
        </View>

        <View style={styles.section}>
          <View style={styles.textRow}>
            <Text style={styles.attributeTextPrimary}>Email: </Text> 
            {editing ?
            <TextInput style={styles.editText} onChangeText={setEmail} value={email} placeholder={'Edit Email'} ref={inputArea}></TextInput>:
            <Text style={styles.attributeTextSecondary}>{email}</Text>}
            <TouchableOpacity onPress={editEmail}>
              <Image source={editing ? checkIcon : penIcon} style={styles.editImage}/>
            </TouchableOpacity>
          </View>
          
          <View style={styles.textRow}>
            <Text style={styles.attributeTextPrimary}>Joined:</Text>
            <Text style={styles.attributeTextSecondary}>{user.created_at.substring(0, 10)}</Text>
            <Image style={styles.editImage}/>
          </View>
        </View>

        <View style={styles.listingsSection}>
          <Text style={styles.sectionLabel}>Your previous listings</Text>
          <PreviousSpotsList spots={null}/>
        </View>
        <View style={styles.submitSection}>
          {!!errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
          {!!successMessage && <Text style={styles.successText}>{successMessage}</Text>}
          <TouchableOpacity
            style={styles.button}
            onPress={loading ? () => {} : saveChanges}>
            <Text style={styles.buttonText}>{loading ? 'Loading...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#DCDBD8',
  },
  screen: {
    flex: 1,
    position: 'relative',
    paddingHorizontal: H_PAD,
    paddingBottom: SECTION_GAP,
    gap: SECTION_GAP,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: screenWidth * 0.02,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    opacity: 0.75,
  },
  section: {
    marginTop: SECTION_GAP,
    gap: 16,
  },
  sectionLabel: {
    fontFamily: 'SwitzerSemibold',
    fontSize: SECTION_LABEL,
    color: '#000000',
  },
  attributeTextPrimary: {
    fontFamily: 'Switzer',
    fontSize: TEXT_SIZE,
    color: '#000000',
  },
  attributeTextSecondary: {
    fontFamily: 'Switzer',
    fontSize: TEXT_SIZE - 4,
    color: '#000000',
  },
  textRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  editImage: {
    height: SECTION_LABEL + 5,
    width: SECTION_LABEL + 5,
  },
  editText: {
    fontSize: TEXT_SIZE - 4,
    fontFamily: 'Switzer',
    color: '#000000',
    backgroundColor: '#',
  },
  listingsSection: {
    marginTop: SECTION_GAP + 10,
    gap: 12,
  },
  button: {
    backgroundColor: '#000000',
    borderRadius: 999,
    padding: H_PAD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: SECTION_LABEL,
    fontFamily: 'Switzer',
  },
  errorText: {
    color: '#rgba(200, 0, 0, 1)',
    fontSize: SECTION_LABEL - 5,
    fontFamily: 'Switzer',
  },
  successText: {
    color: '#28a745',
    fontSize: SECTION_LABEL - 5,
    fontFamily: 'Switzer',
    textAlign: 'center',
    marginBottom: 8,
  },
  submitSection: {
    marginTop: SECTION_GAP,
    gap: 4,
    justifyContent: 'center',
  }
});