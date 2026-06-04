import { useState } from 'react';
import { router } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  SafeAreaView,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { supabase } from '@/src/utils/supabase';
import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';

import logoAsset from '@/assets/images/spotonlogo.png';
import normalCar from '@/assets/images/profilePage/normalCar.avif';

const { width: screenWidth } = Dimensions.get('window');

const H_PAD = screenWidth * 0.06;
const SECTION_GAP = screenWidth * 0.05;
const TITLE_SIZE = screenWidth * 0.07;
const LABEL_SIZE = screenWidth * 0.035;
const INPUT_SIZE = screenWidth * 0.04;
const LOGO_SIZE = screenWidth * 0.12;

export default function RegisterVehicle() {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [plate, setPlate] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const onAdd = async () => {
    triggerLightHaptic();
    setErrorMessage('');

    const trimmedMake = make.trim();
    const trimmedModel = model.trim();
    const trimmedColor = color.trim();
    const trimmedPlate = plate.trim().toUpperCase();

    if (!trimmedMake || !trimmedModel || !trimmedColor || !trimmedPlate) {
      setErrorMessage('All vehicle fields are required.');
      return;
    }

    setSaving(true);
    const { data: claimsResp, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsResp) {
      setErrorMessage('Could not find your account. Please sign in again.');
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from('vehicles')
      .insert({
        owner_user_id: claimsResp.claims.sub,
        make: trimmedMake,
        model: trimmedModel,
        color: trimmedColor,
        license_plate: trimmedPlate,
      });

    if (error) {
      setErrorMessage(error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    router.replace('./Profile');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps='handled'>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backPill}
            onPress={withLightHaptic(() => router.back())}
            activeOpacity={0.85}
          >
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>
          <Image source={logoAsset} style={styles.logo} resizeMode='contain' />
        </View>

        <View style={styles.heroRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Register Your Car</Text>
            <Text style={styles.subtitle}>
              Add a vehicle to use when reserving spots.
            </Text>
          </View>
          <Image source={normalCar} style={styles.heroImage} resizeMode='contain' />
        </View>

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Make</Text>
            <TextInput
              style={styles.input}
              placeholder='Honda'
              value={make}
              onChangeText={setMake}
              autoCapitalize='words'
              placeholderTextColor='rgba(0,0,0,0.35)'
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Model</Text>
            <TextInput
              style={styles.input}
              placeholder='Civic'
              value={model}
              onChangeText={setModel}
              autoCapitalize='words'
              placeholderTextColor='rgba(0,0,0,0.35)'
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Color</Text>
            <TextInput
              style={styles.input}
              placeholder='Black'
              value={color}
              onChangeText={setColor}
              autoCapitalize='words'
              placeholderTextColor='rgba(0,0,0,0.35)'
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>License Plate</Text>
            <TextInput
              style={styles.input}
              placeholder='ABC1234'
              value={plate}
              onChangeText={setPlate}
              autoCapitalize='characters'
              placeholderTextColor='rgba(0,0,0,0.35)'
            />
          </View>

          {!!errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
        </View>

        <TouchableOpacity
          style={[styles.addButton, saving && styles.addButtonDisabled]}
          onPress={saving ? undefined : onAdd}
        >
          <Text style={styles.addButtonText}>
            {saving ? 'Adding...' : 'Add Vehicle'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#DCDBD8',
  },
  scroll: {
    paddingHorizontal: H_PAD,
    paddingBottom: screenWidth * 0.4,
    gap: SECTION_GAP,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: screenWidth * 0.02,
  },
  backPill: {
    height: screenWidth * 0.12,
    paddingHorizontal: screenWidth * 0.07,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#FFFFFF',
    fontSize: screenWidth * 0.045,
  },
  logo: { width: screenWidth * 0.12, height: screenWidth * 0.12, opacity: 0.75 },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SECTION_GAP,
    gap: 12,
  },
  title: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: TITLE_SIZE,
    color: '#000000',
  },
  subtitle: {
    marginTop: 6,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: LABEL_SIZE,
    color: 'rgba(0,0,0,0.6)',
  },
  heroImage: {
    width: screenWidth * 0.32,
    height: screenWidth * 0.22,
  },
  form: { gap: 14, marginTop: 8 },
  field: { gap: 6 },
  label: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: LABEL_SIZE,
    color: '#000000',
  },
  input: {
    backgroundColor: '#F4F4F4',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: INPUT_SIZE,
    color: '#000000',
  },
  errorText: {
    color: 'rgba(200,0,0,1)',
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: LABEL_SIZE,
  },
  addButton: {
    backgroundColor: '#000000',
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDisabled: { backgroundColor: '#555555' },
  addButtonText: {
    color: '#FFFFFF',
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: INPUT_SIZE,
  },
});
