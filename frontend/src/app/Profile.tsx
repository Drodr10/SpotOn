import { useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  SafeAreaView,
  Image,
  ImageBackground,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/src/utils/supabase';
import { JwtPayload } from '@supabase/supabase-js';

import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';

import logoAsset from '@/assets/images/spotonlogo.png';
import penIcon from '@/assets/images/penicon.png';
import checkIcon from '@/assets/images/checkmarkicon.png';
import normalCar from '@/assets/images/profilePage/normalCar.avif';
import registeredCar from '@/assets/images/profilePage/registeredCar.avif';
import cardPayment from '@/assets/images/profilePage/cardpayment.avif';
import mailIcon from '@/assets/images/profilePage/material-symbols_mail-rounded.png';
import auraGradient from '@/assets/images/profilePage/aura_gradient.png';
import exitIcon from '@/assets/images/profilePage/exit_to_app.png';

const { width: screenWidth } = Dimensions.get('window');

const H_PAD = screenWidth * 0.05;
const SECTION_GAP = screenWidth * 0.04;
const CARD_RADIUS = 22;

const HEADER_BTN_HEIGHT = screenWidth * 0.12;
const PROFILE_CARD_HEIGHT = screenWidth * 0.5;
const AVATAR_SIZE = screenWidth * 0.22;
const NAME_SIZE = screenWidth * 0.06;
const SUB_SIZE = screenWidth * 0.032;
const BANNER_HEIGHT = screenWidth * 0.22;
const BANNER_TEXT = screenWidth * 0.045;
const VEHICLE_CARD_HEIGHT = screenWidth * 0.22;
const VEHICLE_CARD_WIDTH = screenWidth * 0.5;
const BANNER_IMAGE_RIGHT = screenWidth * 0.015;
const VEHICLE_CAR_VISIBLE_RATIO = 0.6;
const VEHICLE_CAR_IMAGE_WIDTH = VEHICLE_CARD_WIDTH;
const VEHICLE_CAR_IMAGE_HEIGHT = VEHICLE_CARD_HEIGHT * 1.3;
const VEHICLE_CAR_CLIP_WIDTH = VEHICLE_CAR_IMAGE_WIDTH * VEHICLE_CAR_VISIBLE_RATIO;
const EMAIL_ICON = screenWidth * 0.09;
const EDIT_ICON = screenWidth * 0.05;
const PROFILE_LOGO = screenWidth * 0.13;


type ProfileData = {
  id: string;
  full_name: string;
  email: string;
  rating_avg: number;
  created_at: string;
  avatar_url: string | null;
};

type VehicleProfile = {
  id: string;
  make: string;
  model: string;
  color: string;
  plate_last4?: string | null;
};

const onSignOut = async () => {
  triggerLightHaptic();
  await supabase.auth.signOut();
  router.replace('/Intro');
};

export default function ProfilePage() {
  const [claims, setClaims] = useState<JwtPayload>();
  const [user, setUser] = useState<ProfileData | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleProfile[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const nameInput = useRef<TextInput>(null);
  const emailInput = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  const loadVehicles = async (ownerUserId: string) => {
    const { data, error } = await supabase
      .from('vehicles')
      .select('id, make, model, color, plate_last4')
      .eq('owner_user_id', ownerUserId)
      .order('created_at', { ascending: false });

    if (error) {
      console.log('Error retrieving vehicles:', error.message);
      return;
    }
    setVehicles((data ?? []) as VehicleProfile[]);
  };

  const loadProfile = async () => {
    const { data: claimsResp, error: claimsErr } = await supabase.auth.getClaims();
    if (claimsErr || !claimsResp) return;

    setClaims(claimsResp.claims);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', claimsResp.claims.sub)
      .single();
    if (error || !data) return;

    setUser(data as ProfileData);
    setName(data.full_name);
    setEmail(data.email);
    await loadVehicles(claimsResp.claims.sub);
  };

  useEffect(() => {
    loadProfile();
  }, []);

  useFocusEffect(() => {
    if (claims?.sub) loadVehicles(claims.sub);
  });

  useEffect(() => {
    if (editingName) nameInput.current?.focus();
  }, [editingName]);

  useEffect(() => {
    if (editingEmail) {
      emailInput.current?.focus();
      // Scroll to bring the email card above the keyboard.
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [editingEmail]);

  const commitName = async () => {
    setEditingName(false);
    if (!user || name === user.full_name) return;
    if (name.length > 20 || name.length <= 3) {
      setErrorMessage('Name must be between 4 and 20 characters.');
      setName(user.full_name);
      return;
    }
    setErrorMessage('');

    const { error: authError } = await supabase.auth.updateUser({
      data: { full_name: name },
    });
    if (authError) {
      setErrorMessage(authError.message);
      setName(user.full_name);
      return;
    }
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name })
      .eq('id', user.id);
    if (error) {
      setErrorMessage(error.message);
      setName(user.full_name);
      return;
    }
    setUser({ ...user, full_name: name });
  };

  const commitEmail = async () => {
    setEditingEmail(false);
    if (!user || email === user.email) return;
    const pattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (!pattern.test(email)) {
      setErrorMessage('Invalid email');
      setEmail(user.email);
      return;
    }
    setErrorMessage('');
    const { error } = await supabase.auth.updateUser({ email });
    if (error) {
      setErrorMessage(error.message);
      setEmail(user.email);
      return;
    }
    setSuccessMessage('Check your new email to confirm the change.');
  };

  const pickAvatar = async () => {
    triggerLightHaptic();
    if (!user) return;

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErrorMessage('Photo permission is required to change your picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setAvatarUploading(true);
    setErrorMessage('');

    try {
      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();

      const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase();
      const contentType =
        asset.mimeType ?? (ext === 'png' ? 'image/png' : 'image/jpeg');
      const path = `${user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, arrayBuffer, { contentType, upsert: true });
      if (uploadError) throw uploadError;

      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);
      if (profileError) throw profileError;

      setUser({ ...user, avatar_url: publicUrl });
    } catch (e: any) {
      setErrorMessage(e.message ?? 'Failed to upload avatar.');
    } finally {
      setAvatarUploading(false);
    }
  };

  if (!user) return <SafeAreaView style={styles.safeArea} />;

  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleString('default', {
        month: 'long',
        year: 'numeric',
      })
    : '';

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps='handled'
        >
          {/* Header: Profile pill + Logout square */}
          <View style={styles.header}>
            <View style={styles.profilePill}>
              <Text style={styles.profilePillText}>Profile</Text>
            </View>
            <TouchableOpacity
              style={styles.logoutButton}
              onPress={onSignOut}
              activeOpacity={0.85}
            >
              <Image source={exitIcon} style={styles.logoutIcon} resizeMode='contain' />
            </TouchableOpacity>
          </View>

          {/* Profile Card */}
          <ImageBackground
            source={auraGradient}
            style={styles.profileCard}
            imageStyle={styles.profileCardBg}
            resizeMode='cover'
          >
            {/* Top-right: name + member since */}
            <View style={styles.profileTextWrap}>
              {editingName ? (
                <TextInput
                  ref={nameInput}
                  style={[styles.nameText, styles.nameInput]}
                  value={name}
                  onChangeText={setName}
                  onBlur={commitName}
                  onSubmitEditing={commitName}
                  returnKeyType='done'
                  maxLength={20}
                  textAlign='right'
                />
              ) : (
                <TouchableOpacity onPress={withLightHaptic(() => setEditingName(true))}>
                  <Text style={styles.nameText} numberOfLines={1}>
                    {name}
                  </Text>
                </TouchableOpacity>
              )}
              <Text style={styles.memberText}>Member since {memberSince}</Text>
            </View>

            {/* Bottom-left: avatar */}
            <TouchableOpacity
              onPress={pickAvatar}
              activeOpacity={0.85}
              style={styles.avatarTouch}
            >
              {user.avatar_url ? (
                <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]} />
              )}
              {avatarUploading && (
                <View style={styles.avatarOverlay}>
                  <ActivityIndicator color='#FFFFFF' />
                </View>
              )}
            </TouchableOpacity>

            {/* Bottom-right: SpotOn logo */}
            <Image
              source={logoAsset}
              style={styles.profileCardLogo}
              resizeMode='contain'
            />
          </ImageBackground>

          {/* Register Your Car banner */}
          <TouchableOpacity
            style={styles.banner}
            activeOpacity={0.85}
            onPress={withLightHaptic(() => router.push('./RegisterVehicle'))}
          >
            <Text style={styles.bannerText}>Register Your{'\n'}Car</Text>
            <Image source={normalCar} style={styles.bannerCar} resizeMode='contain' />
          </TouchableOpacity>

          {/* Vehicles list */}
          {vehicles.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.vehicleList}
            >
              {vehicles.map((v) => (
                <View key={v.id} style={styles.vehicleCard}>
                  <Text style={styles.vehicleCardText} numberOfLines={2}>
                    {`${v.make}\n${v.model}`}
                  </Text>
                  <View style={styles.vehicleCarClip}>
                    <Image
                      source={registeredCar}
                      style={styles.vehicleCarImage}
                      resizeMode='contain'
                    />
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Setup Payouts banner */}
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Setup{'\n'}Payouts</Text>
            <Image source={cardPayment} style={styles.bannerCard} resizeMode='contain' />
          </View>

          {/* Email card */}
          <View style={styles.emailCard}>
            <Image source={mailIcon} style={styles.mailIcon} resizeMode='contain' />
            {editingEmail ? (
              <TextInput
                ref={emailInput}
                style={[styles.emailText, styles.emailInput]}
                value={email}
                onChangeText={setEmail}
                onBlur={commitEmail}
                onSubmitEditing={commitEmail}
                keyboardType='email-address'
                autoCapitalize='none'
                returnKeyType='done'
              />
            ) : (
              <TouchableOpacity
                style={styles.emailTextWrap}
                onPress={withLightHaptic(() => setEditingEmail(true))}
              >
                <Text style={styles.emailText} numberOfLines={1}>
                  {email}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={withLightHaptic(() => setEditingEmail((e) => !e))}>
              <Image
                source={editingEmail ? checkIcon : penIcon}
                style={styles.penIcon}
              />
            </TouchableOpacity>
          </View>

          {!!errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
          {!!successMessage && <Text style={styles.successText}>{successMessage}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#DCDBD8' },
  scroll: {
    paddingHorizontal: H_PAD,
    paddingTop: screenWidth * 0.02,
    paddingBottom: screenWidth * 0.5,
    gap: SECTION_GAP,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profilePill: {
    height: HEADER_BTN_HEIGHT,
    paddingHorizontal: screenWidth * 0.07,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePillText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.045,
    color: '#FFFFFF',
  },
  logoutButton: {
    width: HEADER_BTN_HEIGHT,
    height: HEADER_BTN_HEIGHT,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutIcon: {
    width: HEADER_BTN_HEIGHT * 0.55,
    height: HEADER_BTN_HEIGHT * 0.55,
    tintColor: '#FFFFFF',
  },

  // Profile card
  profileCard: {
    height: PROFILE_CARD_HEIGHT,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    padding: screenWidth * 0.05,
  },
  profileCardBg: {
    borderRadius: CARD_RADIUS,
  },
  profileTextWrap: {
    position: 'absolute',
    top: screenWidth * 0.05,
    right: screenWidth * 0.05,
    alignItems: 'flex-end',
    maxWidth: '70%',
  },
  nameText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: NAME_SIZE,
    color: '#000000',
    textAlign: 'right',
  },
  nameInput: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.3)',
    paddingVertical: 0,
    minWidth: screenWidth * 0.5,
  },
  memberText: {
    marginTop: 4,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SUB_SIZE,
    color: 'rgba(0,0,0,0.75)',
    textAlign: 'right',
  },
  avatarTouch: {
    position: 'absolute',
    left: screenWidth * 0.05,
    bottom: screenWidth * 0.05,
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: 'hidden',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarPlaceholder: {
    backgroundColor: '#1A1A1A',
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCardLogo: {
    position: 'absolute',
    right: screenWidth * 0.02,
    bottom: screenWidth * 0.02,
    width: PROFILE_LOGO,
    height: PROFILE_LOGO,
    opacity: 0.85,
  },

  // Banners
  banner: {
    height: BANNER_HEIGHT,
    borderRadius: CARD_RADIUS,
    backgroundColor: '#F4F4F4',
    overflow: 'hidden',
    paddingHorizontal: screenWidth * 0.05,
    justifyContent: 'center',
  },
  bannerText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: BANNER_TEXT,
    color: '#000000',
    lineHeight: BANNER_TEXT * 1.15,
  },
  bannerCar: {
    position: 'absolute',
    right: BANNER_IMAGE_RIGHT,
    width: screenWidth * 0.3,
    height: '100%',
  },
  bannerCard: {
    position: 'absolute',
    right: BANNER_IMAGE_RIGHT,
    width: screenWidth * 0.3,
    height: '95%',
  },

  // Vehicle list
  vehicleList: {
    gap: screenWidth * 0.03,
    paddingRight: H_PAD,
  },
  vehicleCard: {
    width: VEHICLE_CARD_WIDTH,
    height: VEHICLE_CARD_HEIGHT,
    borderRadius: CARD_RADIUS,
    backgroundColor: '#F4F4F4',
    overflow: 'hidden',
    paddingLeft: screenWidth * 0.04,
    justifyContent: 'center',
  },
  vehicleCardText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.035,
    color: '#000000',
    lineHeight: screenWidth * 0.04,
    maxWidth: '55%',
  },
  vehicleCarClip: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: VEHICLE_CAR_CLIP_WIDTH,
    overflow: 'hidden',
  },
  vehicleCarImage: {
    position: 'absolute',
    left: 0,
    top: (VEHICLE_CARD_HEIGHT - VEHICLE_CAR_IMAGE_HEIGHT) / 2,
    width: VEHICLE_CAR_IMAGE_WIDTH,
    height: VEHICLE_CAR_IMAGE_HEIGHT,
  },

  // Email card
  emailCard: {
    minHeight: BANNER_HEIGHT * 0.7,
    borderRadius: CARD_RADIUS,
    backgroundColor: '#F4F4F4',
    paddingHorizontal: screenWidth * 0.05,
    paddingVertical: screenWidth * 0.04,
    flexDirection: 'row',
    alignItems: 'center',
    gap: screenWidth * 0.03,
  },
  mailIcon: {
    width: EMAIL_ICON,
    height: EMAIL_ICON,
  },
  emailTextWrap: { flex: 1 },
  emailText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.038,
    color: '#000000',
  },
  emailInput: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.3)',
    paddingVertical: 0,
  },
  penIcon: { width: EDIT_ICON, height: EDIT_ICON },

  errorText: {
    color: 'rgba(200,0,0,1)',
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.035,
    textAlign: 'center',
  },
  successText: {
    color: '#28a745',
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.035,
    textAlign: 'center',
  },
});
