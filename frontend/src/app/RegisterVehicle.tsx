import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '@/src/utils/supabase';
import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';
import {
  US_PLATE_STATES,
  isPlateState,
  normalizePlate,
  isVinShaped,
  decodeVin,
  vehicleSaveErrorMessage,
  isMissingPlateStateColumn,
} from '@/src/utils/vehicles';

import logoAsset from '@/assets/images/spotonlogo.png';
import normalCar from '@/assets/images/profilePage/normalCar.avif';

const { width: screenWidth } = Dimensions.get('window');

const H_PAD = screenWidth * 0.06;
const SECTION_GAP = screenWidth * 0.05;
const TITLE_SIZE = screenWidth * 0.07;
const LABEL_SIZE = screenWidth * 0.035;
const INPUT_SIZE = screenWidth * 0.04;

/**
 * Add a car, or edit/remove one when opened with `?vehicleId=`.
 *
 * Writes go straight to `vehicles` under the owner RLS policies. A car on a
 * booking that hasn't finished is frozen by trg_guard_vehicle_in_active_booking
 * (20261116140000) — the host identifies it by its live row — and the DB
 * message is shown as-is.
 */
export default function RegisterVehicle() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId?: string }>();
  const editing = !!vehicleId;

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [plate, setPlate] = useState('');
  const [plateState, setPlateState] = useState<string | null>(null);
  const [vin, setVin] = useState('');
  const [vinBusy, setVinBusy] = useState(false);
  const [vinNote, setVinNote] = useState('');
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // Bumped on every lookup and VIN edit so a slow, stale response can't
  // overwrite what the user has since typed.
  const vinRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    (async () => {
      // select('*') rather than naming plate_state, so this still loads against
      // a database where that migration hasn't been applied yet.
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();
      if (cancelled) return;
      if (error || !data) {
        setErrorMessage("Couldn't load this car. Go back and try again.");
      } else {
        setMake(data.make ?? '');
        setModel(data.model ?? '');
        setColor(data.color ?? '');
        setPlate(data.license_plate ?? '');
        setPlateState(data.plate_state ?? null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [vehicleId]);

  const lookUpVin = async () => {
    triggerLightHaptic();
    setVinNote('');
    if (!isVinShaped(vin)) {
      setVinNote('A VIN is 17 letters and numbers (no I, O or Q).');
      return;
    }
    const req = ++vinRequest.current;
    const makeAtStart = make;
    const modelAtStart = model;
    setVinBusy(true);
    try {
      const decoded = await decodeVin(vin);
      if (!mounted.current || req !== vinRequest.current) return;
      if (!decoded) {
        setVinNote("We couldn't find that VIN. You can fill the details in yourself.");
        return;
      }
      // Only fill fields the user hasn't changed while the lookup ran.
      setMake((cur) => (cur === makeAtStart ? decoded.make : cur));
      setModel((cur) => (cur === modelAtStart ? decoded.model : cur));
      setVinNote(`Found: ${[decoded.year, decoded.make, decoded.model].filter(Boolean).join(' ')}`);
    } catch {
      if (mounted.current && req === vinRequest.current) {
        setVinNote("Couldn't reach the VIN lookup. You can fill the details in yourself.");
      }
    } finally {
      if (mounted.current && req === vinRequest.current) setVinBusy(false);
    }
  };

  const onSave = async () => {
    triggerLightHaptic();
    setErrorMessage('');

    const fields = {
      make: make.trim(),
      model: model.trim(),
      color: color.trim(),
      license_plate: normalizePlate(plate),
      plate_state: plateState,
    };

    if (!fields.make || !fields.model || !fields.color || !fields.license_plate) {
      setErrorMessage('All vehicle fields are required.');
      return;
    }
    if (!isPlateState(fields.plate_state)) {
      setErrorMessage('Pick the state shown on your plate.');
      return;
    }

    setSaving(true);
    let error: { message?: string; code?: string } | null = null;

    if (editing) {
      // .select() so an RLS-filtered no-op (0 rows) is distinguishable from success.
      const update = (payload: Record<string, unknown>) =>
        supabase.from('vehicles').update(payload).eq('id', vehicleId).select('id');
      let res = await update(fields);
      if (isMissingPlateStateColumn(res.error)) {
        const { plate_state: _omit, ...withoutState } = fields;
        res = await update(withoutState);
      }
      error = res.error ?? (res.data?.length ? null : { message: "Couldn't find this car on your account." });
    } else {
      const { data: claimsResp, error: claimsError } = await supabase.auth.getClaims();
      if (claimsError || !claimsResp) {
        setErrorMessage('Could not find your account. Please sign in again.');
        setSaving(false);
        return;
      }
      const insert = (payload: Record<string, unknown>) =>
        supabase.from('vehicles').insert({ owner_user_id: claimsResp.claims.sub, ...payload });
      let res = await insert(fields);
      if (isMissingPlateStateColumn(res.error)) {
        // DB is behind this build (20261116140000 not applied): save the car
        // without its state rather than block adding cars — and so booking.
        const { plate_state: _omit, ...withoutState } = fields;
        res = await insert(withoutState);
      }
      error = res.error;
    }

    setSaving(false);
    if (error) {
      setErrorMessage(vehicleSaveErrorMessage(error));
      return;
    }
    router.back();
  };

  const onRemove = () => {
    triggerLightHaptic();
    Alert.alert(
      'Remove this car?',
      'Past bookings are kept, but they will no longer show which car was used.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            setErrorMessage('');
            const { data, error } = await supabase
              .from('vehicles')
              .delete()
              .eq('id', vehicleId)
              .select('id');
            setRemoving(false);
            if (error || !data?.length) {
              setErrorMessage(vehicleSaveErrorMessage(error ?? { message: "Couldn't remove this car." }));
              return;
            }
            router.back();
          },
        },
      ],
    );
  };

  const busy = saving || removing || loading;
  const stateName = US_PLATE_STATES.find((s) => s.code === plateState)?.name;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
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
            <Text style={styles.title}>{editing ? 'Edit Your Car' : 'Register Your Car'}</Text>
            <Text style={styles.subtitle}>
              {editing ? 'Update details or remove this car.' : 'Add a vehicle to use when reserving spots.'}
            </Text>
          </View>
          <Image source={normalCar} style={styles.heroImage} resizeMode='contain' />
        </View>

        {loading ? (
          <ActivityIndicator color='#000' style={{ marginTop: SECTION_GAP }} />
        ) : (
        <View style={styles.form}>
          {!editing && (
            <View style={styles.field}>
              <Text style={styles.label}>VIN (optional)</Text>
              <View style={styles.vinRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder='Fills in make and model'
                  value={vin}
                  onChangeText={(t) => {
                    vinRequest.current++;
                    setVin(t.toUpperCase());
                    setVinNote('');
                    setVinBusy(false);
                  }}
                  autoCapitalize='characters'
                  autoCorrect={false}
                  maxLength={17}
                  placeholderTextColor='rgba(0,0,0,0.35)'
                />
                <TouchableOpacity
                  style={[styles.vinButton, vinBusy && styles.addButtonDisabled]}
                  onPress={vinBusy ? undefined : lookUpVin}
                  accessibilityLabel='Look up VIN'
                >
                  {vinBusy
                    ? <ActivityIndicator color='#FFF' />
                    : <Text style={styles.vinButtonText}>Look up</Text>}
                </TouchableOpacity>
              </View>
              {!!vinNote && <Text style={styles.hint}>{vinNote}</Text>}
            </View>
          )}

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

          <View style={styles.plateRow}>
            <View style={[styles.field, styles.stateField]}>
              <Text style={styles.label}>State</Text>
              <TouchableOpacity
                style={[styles.input, styles.stateButton]}
                onPress={withLightHaptic(() => setStatePickerOpen(true))}
                accessibilityRole='button'
                accessibilityLabel={stateName ? `Plate state, ${stateName}` : 'Choose plate state'}
              >
                <Text style={[styles.stateText, !plateState && styles.placeholderText]}>
                  {plateState ?? 'State'}
                </Text>
                <Ionicons name='chevron-down' size={INPUT_SIZE} color='rgba(0,0,0,0.5)' />
              </TouchableOpacity>
            </View>

            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>License Plate</Text>
              <TextInput
                style={styles.input}
                placeholder='ABC1234'
                value={plate}
                onChangeText={setPlate}
                autoCapitalize='characters'
                autoCorrect={false}
                placeholderTextColor='rgba(0,0,0,0.35)'
              />
            </View>
          </View>

          {!!errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
        </View>
        )}

        <TouchableOpacity
          style={[styles.addButton, busy && styles.addButtonDisabled]}
          onPress={busy ? undefined : onSave}
        >
          <Text style={styles.addButtonText}>
            {saving
              ? (editing ? 'Saving...' : 'Adding...')
              : (editing ? 'Save Changes' : 'Add Vehicle')}
          </Text>
        </TouchableOpacity>

        {editing && !loading && (
          <TouchableOpacity
            style={styles.removeButton}
            onPress={busy ? undefined : onRemove}
            accessibilityRole='button'
          >
            <Text style={styles.removeButtonText}>{removing ? 'Removing...' : 'Remove car'}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={statePickerOpen}
        animationType='slide'
        presentationStyle='pageSheet'
        onRequestClose={() => setStatePickerOpen(false)}
      >
        <SafeAreaView style={styles.pickerSafe} edges={['top', 'bottom']}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Plate state</Text>
            <TouchableOpacity onPress={() => setStatePickerOpen(false)} hitSlop={12}>
              <Text style={styles.pickerDone}>Done</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={US_PLATE_STATES as { code: string; name: string }[]}
            keyExtractor={(s) => s.code}
            initialNumToRender={20}
            renderItem={({ item }) => {
              const selected = item.code === plateState;
              return (
                <Pressable
                  style={({ pressed }) => [styles.pickerRow, pressed && { opacity: 0.6 }]}
                  onPress={() => {
                    triggerLightHaptic();
                    setPlateState(item.code);
                    setStatePickerOpen(false);
                    // Clear a stale "Pick the state…" error once they've picked one.
                    setErrorMessage((m) => (m === 'Pick the state shown on your plate.' ? '' : m));
                  }}
                  accessibilityState={{ selected }}
                >
                  <Text style={styles.pickerCode}>{item.code}</Text>
                  <Text style={styles.pickerName}>{item.name}</Text>
                  {selected && <Ionicons name='checkmark' size={INPUT_SIZE * 1.3} color='#000' />}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
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
    paddingTop: screenWidth * 0.05,
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
  hint: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: LABEL_SIZE,
    color: 'rgba(0,0,0,0.6)',
  },
  vinRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  vinButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: screenWidth * 0.24,
  },
  vinButtonText: {
    color: '#FFFFFF',
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: LABEL_SIZE,
  },
  plateRow: { flexDirection: 'row', gap: 10 },
  stateField: { width: screenWidth * 0.24 },
  stateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stateText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: INPUT_SIZE,
    color: '#000000',
  },
  placeholderText: { color: 'rgba(0,0,0,0.35)', fontFamily: CustomFonts.SwitzerLight },
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
  removeButton: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  removeButtonText: {
    color: 'rgba(200,0,0,1)',
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: INPUT_SIZE,
  },
  pickerSafe: { flex: 1, backgroundColor: '#FFFFFF' },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PAD,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.15)',
  },
  pickerTitle: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.05,
    color: '#000',
  },
  pickerDone: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: INPUT_SIZE,
    color: '#000',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: H_PAD,
    paddingVertical: 14,
    gap: 14,
  },
  pickerCode: {
    width: screenWidth * 0.1,
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: INPUT_SIZE,
    color: '#000',
  },
  pickerName: {
    flex: 1,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: INPUT_SIZE,
    color: '#000',
  },
});
