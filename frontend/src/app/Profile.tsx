import { useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Image,
  ImageBackground,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser'

import { supabase } from '@/src/utils/supabase';
import { JwtPayload } from '@supabase/supabase-js';

import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';
import { api, type ActiveReservation } from '@/src/utils/api';
import ReservationInfoCard from '@/src/components/ProfilePageComponents/ReservationInfoCard';
import { MENU_BAR_HEIGHT } from '@/src/components/MenuBar';

import logoAsset from '@/assets/images/spotonlogo.png';
import penIcon from '@/assets/images/penicon.png';
import checkIcon from '@/assets/images/checkmarkicon.png';
import normalCar from '@/assets/images/profilePage/normalCar.avif';
import registeredCar from '@/assets/images/profilePage/registeredCar.avif';
import cardPayment from '@/assets/images/profilePage/cardpayment.avif';
import mailIcon from '@/assets/images/profilePage/material-symbols_mail-rounded.png';
import auraGradient from '@/assets/images/profilePage/aura_gradient.png';
import exitIcon from '@/assets/images/profilePage/exit_to_app.png';
import carParkingIcon from '@/assets/images/carparking.png';
import addListingIcon from '@/assets/images/addlistingimage.png';

import { stripe } from '@/src/utils/stripe';

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
  const [activeReservations, setActiveReservations] = useState<ActiveReservation[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [payoutSetup, setPayoutSetup] = useState(false);
  const [stripeOnboardingLoading, setStripeOnboardingLoading] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

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
    setPayoutSetup(data.stripe_account_id);
    await loadVehicles(claimsResp.claims.sub);
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const loadActiveReservations = async (userId: string) => {
    // Only reservations that have actually started belong on this card —
    // scheduled-but-not-started reservations live on the Homescreen banner
    // and the "Upcoming Reservations" section instead.
    const data = await api.getInProgressReservations(userId);
    setActiveReservations(data ?? []);
  };

  useFocusEffect(() => {
    if (claims?.sub) {
      loadVehicles(claims.sub);
      loadActiveReservations(claims.sub);
    }
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

  const beginStripeOnboarding = async () => {
    if (payoutSetup || !claims?.sub || stripeOnboardingLoading) return;
    setStripeOnboardingLoading(true);

    try {
      await stripe.fetchStripeAccountId(claims.sub);
      const onboardingLink = await stripe.fetchStripeAccountLink(claims.sub);

      if (onboardingLink) {
        await WebBrowser.openBrowserAsync(onboardingLink);
        // Backstop the webhook: sync payout status from Stripe on return.
        await stripe.syncAccount(claims.sub);
        await loadProfile();
      }
    }
    catch (err) {
      console.log("Error starting onboarding process: " + err);
    }
    finally { 
      setStripeOnboardingLoading(false); 
    }
  }

  // App Store Guideline 5.1.1(v): an account created in the app must be
  // deletable from inside it. What "delete" means here is spelled out for the
  // user before they commit — the backend anonymises and keeps the shared
  // transactional record rather than erasing the other party's history too.
  const runAccountDeletion = async () => {
    setDeletingAccount(true);
    setErrorMessage('');
    try {
      const result = await api.deleteAccount();

      if (result.status === 'blocked') {
        Alert.alert("You can't delete your account yet", result.reasons.join('\n\n'));
        return;
      }
      if (result.status === 'error') {
        Alert.alert('Something went wrong', result.message);
        return;
      }

      // Only past a confirmed success. Signing out any earlier would drop the
      // token the request itself needs.
      //
      // scope 'local' because the server has just soft-deleted this user: a
      // global sign-out calls the server on behalf of an account that no longer
      // accepts calls, and would leave the session on the device.
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // The account is gone either way; never strand the user on this screen.
      }
      router.replace('/Intro');
    } finally {
      setDeletingAccount(false);
    }
  };

  const confirmDeleteAccount = () => {
    triggerLightHaptic();
    Alert.alert(
      'Delete your account?',
      'This cannot be undone.\n\n' +
        'Your name, email, photo and saved vehicles are removed, and your ' +
        'listings stop accepting bookings.\n\n' +
        'Past bookings and messages stay on record — they are the other ' +
        "person's history too, and payment records have to be kept.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: runAccountDeletion },
      ],
    );
  };

  if (!user) return <SafeAreaView style={styles.safeArea} edges={['top']} />;

  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleString('default', {
        month: 'long',
        year: 'numeric',
      })
    : '';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps='handled'
          showsVerticalScrollIndicator={false}
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

          {/* Current reservation(s) — horizontal scroll when multiple. */}
          {activeReservations.length > 0 && (
            activeReservations.length === 1 ? (
              <View style={styles.singleReservationWrap}>
                <ReservationInfoCard
                  address={activeReservations[0].listingData.address}
                  endTime={activeReservations[0].end_time}
                  totalPrice={activeReservations[0].total_price}
                  photoUrl={activeReservations[0].listingData.photo_url}
                  variant='current'
                  width={screenWidth - H_PAD * 2}
                />
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.reservationList}
                snapToAlignment='start'
                decelerationRate='fast'
              >
                {activeReservations.map((r) => (
                  <ReservationInfoCard
                    key={r.id}
                    address={r.listingData.address}
                    endTime={r.end_time}
                    totalPrice={r.total_price}
                    photoUrl={r.listingData.photo_url}
                    variant='current'
                    width={screenWidth * 0.82}
                  />
                ))}
              </ScrollView>
            )
          )}

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
          <TouchableOpacity 
            style={styles.banner}
            activeOpacity={0.85}
            onPress={withLightHaptic(async () => beginStripeOnboarding())}
          >
            <Text style={styles.bannerText}>
              { stripeOnboardingLoading ? 'Loading...' : 
                payoutSetup ? 'Payouts\nSetup!' : 'Setup\nPayouts'}
            </Text>
            <Image source={cardPayment} style={styles.bannerCard} resizeMode='contain' />
          </TouchableOpacity>

          {/* Your Reservations banner — opens history page */}
          <TouchableOpacity
            style={styles.banner}
            activeOpacity={0.85}
            onPress={withLightHaptic(() => router.push('./PreviousReservations'))}
          >
            <Text style={styles.bannerText}>Your{'\n'}Reservations</Text>
            <Image source={carParkingIcon} style={styles.bannerCard} resizeMode='contain' />
          </TouchableOpacity>

          {/* Your Seller Account banner — opens spots/bookings page */}
          <TouchableOpacity
            style={styles.banner}
            activeOpacity={0.85}
            onPress={withLightHaptic(() => router.push('./YourSpots'))}
          >
            <Text style={styles.bannerText}>Your Seller{'\n'}Account</Text>
            <Image source={addListingIcon} style={styles.bannerCard} resizeMode='contain' />
          </TouchableOpacity>

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

          {/* Account deletion. Deliberately plain and at the end of the page:
              Apple requires it be easy to find, not that it be prominent. */}
          <TouchableOpacity
            style={styles.deleteAccountButton}
            onPress={confirmDeleteAccount}
            disabled={deletingAccount}
            activeOpacity={0.7}
          >
            {deletingAccount ? (
              <ActivityIndicator color='rgba(200,0,0,0.9)' />
            ) : (
              <Text style={styles.deleteAccountText}>Delete my account</Text>
            )}
          </TouchableOpacity>

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
    // Extra bottom pad so the last cards can scroll clear of the floating MenuBar,
    // while the page itself extends edge-to-edge underneath it.
    paddingBottom: MENU_BAR_HEIGHT + screenWidth * 0.1,
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

  // Active reservation list
  singleReservationWrap: {
    alignItems: 'center',
  },
  reservationList: {
    gap: screenWidth * 0.04,
    paddingRight: H_PAD,
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

  deleteAccountButton: {
    alignSelf: 'center',
    paddingVertical: screenWidth * 0.03,
    paddingHorizontal: screenWidth * 0.06,
    minHeight: screenWidth * 0.11,
    justifyContent: 'center',
  },
  deleteAccountText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.035,
    color: 'rgba(200,0,0,0.9)',
    textDecorationLine: 'underline',
  },

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
