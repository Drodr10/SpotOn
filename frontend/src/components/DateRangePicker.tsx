/**
 * DateRangePicker — floating card date-range picker with month nav + day grid.
 *
 * Visually styled to match the Daily / Monthly / Totals rate cards in
 * CreateListing2: solid-black floating card, spring animation, full border
 * radius, side margins, and translucent white action buttons.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';
import accessibilityImg from '@/assets/images/accessibility.png';
import spotonLogoCircleAsset from '@/assets/images/spotonlogocircle.png';

const { width: W } = Dimensions.get('window');
const H_PAD = W * 0.06;
const CARD_H_PAD = W * 0.05; // inner horizontal padding of the card
const CARD_RADIUS = 25;
const SLIDE_OUT_DISTANCE = 600; // far enough to slide fully off screen

const calendarCellWidth = (W - H_PAD * 2 - CARD_H_PAD * 2) / 7;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const getDaysInMonth = (year: number, month: number) =>
  new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year: number, month: number) =>
  new Date(year, month, 1).getDay();

export interface DateRangePickerProps {
  visible: boolean;
  initialStart?: Date | null;
  initialEnd?: Date | null;
  /** Helper text shown at the top of the popup. */
  helperText?: string;
  /** Label on the right-side confirm button. */
  confirmLabel?: string;
  /** Disable the confirm button (e.g. while submitting). */
  confirmDisabled?: boolean;
  /**
   * When true, only a single date can be selected — every tap replaces the
   * current pick and `endDate` is always null. Defaults to false (range mode).
   */
  singleSelect?: boolean;
  /** @deprecated No longer applied — card style uses fixed solid-black fill. */
  popupOpacity?: number;
  /** @deprecated No longer applied — card side margins are fixed. */
  sideMarginPercent?: number;
  onClose: () => void;
  onConfirm: (start: Date, end: Date | null) => void;
}

export default function DateRangePicker({
  visible,
  initialStart = null,
  initialEnd = null,
  helperText = 'Tap a start date, then tap an end date.',
  confirmLabel = 'Confirm',
  confirmDisabled = false,
  singleSelect = false,
  onClose,
  onConfirm,
}: DateRangePickerProps) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SLIDE_OUT_DISTANCE)).current;

  const [calendarYear, setCalendarYear] = useState(
    initialStart ? initialStart.getFullYear() : new Date().getFullYear(),
  );
  const [calendarMonth, setCalendarMonth] = useState(
    initialStart ? initialStart.getMonth() : new Date().getMonth(),
  );
  const [pickingStart, setPickingStart] = useState(true);
  const [startDate, setStartDate] = useState<Date | null>(initialStart);
  const [endDate, setEndDate] = useState<Date | null>(initialEnd);

  // Spring animation — matches the Daily / Monthly / Totals card behaviour
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : SLIDE_OUT_DISTANCE,
      damping: 14,
      stiffness: 130,
      mass: 1,
      useNativeDriver: true,
    }).start();
  }, [visible, slideAnim]);

  // Re-sync internal state when initial values change while picker is hidden
  useEffect(() => {
    if (!visible) {
      setStartDate(initialStart ?? null);
      setEndDate(initialEnd ?? null);
      setPickingStart(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const cells = useMemo<(number | null)[]>(() => {
    const daysInMonth = getDaysInMonth(calendarYear, calendarMonth);
    const firstDay = getFirstDayOfMonth(calendarYear, calendarMonth);
    return [
      ...Array(firstDay).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
  }, [calendarYear, calendarMonth]);

  const handleDayPress = (day: number) => {
    const selected = new Date(calendarYear, calendarMonth, day);
    if (singleSelect) {
      setStartDate(selected);
      setEndDate(null);
      return;
    }
    if (pickingStart) {
      setStartDate(selected);
      setEndDate(null);
      setPickingStart(false);
    } else {
      if (startDate && selected < startDate) {
        setEndDate(startDate);
        setStartDate(selected);
      } else {
        setEndDate(selected);
      }
      setPickingStart(true);
    }
  };

  const isDaySelected = (day: number): 'start' | 'end' | 'range' | null => {
    const d = new Date(calendarYear, calendarMonth, day);
    if (startDate && d.toDateString() === startDate.toDateString()) return 'start';
    if (endDate && d.toDateString() === endDate.toDateString()) return 'end';
    if (startDate && endDate && d > startDate && d < endDate) return 'range';
    return null;
  };

  const stepMonth = (delta: -1 | 1) => {
    let m = calendarMonth + delta;
    let y = calendarYear;
    if (m < 0) { m = 11; y -= 1; }
    else if (m > 11) { m = 0; y += 1; }
    setCalendarMonth(m);
    setCalendarYear(y);
  };

  const rangeHint = singleSelect
    ? startDate
      ? `Selected: ${startDate.toLocaleDateString()}`
      : 'Tap a date'
    : startDate
    ? endDate
      ? `${startDate.toLocaleDateString()} → ${endDate.toLocaleDateString()}`
      : `Start: ${startDate.toLocaleDateString()} — tap end date`
    : 'Tap a start date';

  const LOGO_SIZE = W * 0.075;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.card,
        {
          bottom: W * 0.05 + insets.bottom,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      {/* SpotOn logo — top-right corner, matches rate popup cards */}
      <Image
        source={spotonLogoCircleAsset}
        style={[styles.logo, { width: LOGO_SIZE, height: LOGO_SIZE }]}
        resizeMode="contain"
      />

      {/* Helper row */}
      <View style={styles.helperRow}>
        <Image source={accessibilityImg} style={styles.helperIcon} />
        <Text style={styles.helperText}>{helperText}</Text>
      </View>

      {/* Month navigation */}
      <View style={styles.navRow}>
        <TouchableOpacity
          onPress={withLightHaptic(() => stepMonth(-1))}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.monthText}>
          {MONTHS[calendarMonth]} {calendarYear}
        </Text>
        <TouchableOpacity
          onPress={withLightHaptic(() => stepMonth(1))}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-forward" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Day-of-week labels */}
      <View style={styles.daysRow}>
        {DAY_LABELS.map((d) => (
          <Text key={d} style={[styles.dayLabel, { width: calendarCellWidth }]}>
            {d}
          </Text>
        ))}
      </View>

      {/* Date cells */}
      <View style={styles.grid}>
        {cells.map((day, idx) => {
          if (day === null) {
            return (
              <View
                key={`empty-${idx}`}
                style={[styles.cell, { width: calendarCellWidth }]}
              />
            );
          }
          const sel = isDaySelected(day);
          return (
            <TouchableOpacity
              key={`day-${day}`}
              style={[
                styles.cell,
                { width: calendarCellWidth },
                sel === 'start' || sel === 'end'
                  ? styles.cellSelected
                  : sel === 'range'
                  ? styles.cellRange
                  : null,
              ]}
              onPress={() => {
                triggerLightHaptic();
                handleDayPress(day);
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.dayText,
                  (sel === 'start' || sel === 'end') && styles.dayTextSelected,
                ]}
              >
                {day}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Range / selection hint */}
      <Text style={styles.rangeHint}>{rangeHint}</Text>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Action row */}
      <View style={styles.bottomRow}>
        <TouchableOpacity
          style={styles.backCircle}
          onPress={withLightHaptic(onClose)}
          activeOpacity={0.8}
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmBtn, confirmDisabled && { opacity: 0.5 }]}
          onPress={() => {
            if (confirmDisabled) return;
            triggerLightHaptic();
            if (startDate) onConfirm(startDate, endDate);
          }}
          disabled={confirmDisabled}
          activeOpacity={0.8}
        >
          <Text style={styles.confirmBtnText}>{confirmLabel}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // ── Floating card — mirrors ratePopup in CreateListing2 ───────────────────
  card: {
    position: 'absolute',
    left: H_PAD,
    right: H_PAD,
    backgroundColor: '#000',
    borderRadius: CARD_RADIUS,
    paddingTop: W * 0.055,
    paddingBottom: W * 0.045,
    paddingHorizontal: CARD_H_PAD,
    zIndex: 20,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },

  // ── SpotOn logo ────────────────────────────────────────────────────────────
  logo: {
    position: 'absolute',
    top: W * 0.045,
    right: CARD_H_PAD,
    opacity: 0.9,
    zIndex: 1,
  },

  // ── Helper row ─────────────────────────────────────────────────────────────
  helperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: W * 0.02,
    marginBottom: W * 0.04,
    paddingRight: W * 0.12, // leave room for the logo
  },
  helperIcon: {
    width: 16,
    height: 16,
    marginTop: 2,
    tintColor: '#fff',
  },
  helperText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 13,
    color: '#fff',
    flex: 1,
    lineHeight: 18,
  },

  // ── Month navigation ───────────────────────────────────────────────────────
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: W * 0.03,
  },
  monthText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 15,
    color: '#fff',
  },

  // ── Day labels ─────────────────────────────────────────────────────────────
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: W * 0.015,
  },
  dayLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
  },

  // ── Calendar grid ──────────────────────────────────────────────────────────
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
  },
  cellSelected: { backgroundColor: '#fff' },
  cellRange: { backgroundColor: 'rgba(255,255,255,0.2)' },
  dayText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 13,
    color: '#fff',
  },
  dayTextSelected: {
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#000',
  },

  // ── Range hint ─────────────────────────────────────────────────────────────
  rangeHint: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    marginTop: W * 0.025,
    marginBottom: W * 0.025,
  },

  // ── Divider ────────────────────────────────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: W * 0.035,
  },

  // ── Action buttons — match ratePopupContinue ───────────────────────────────
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: W * 0.03,
  },
  backCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 15,
    color: '#fff',
  },
});
