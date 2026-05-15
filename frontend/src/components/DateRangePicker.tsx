/**
 * DateRangePicker — slide-up date-range picker with month nav + day grid.
 *
 * Extracted from `CreateListing2.tsx` Scene 5. Behavior preserved exactly:
 * pickingStart toggles between start/end on each tap; if user picks an end
 * date earlier than the current start, the dates swap.
 *
 * Dark theme (rgba black popup, white text) matches the original. If a
 * different look is needed for another caller, add a `theme` prop later.
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
import { Ionicons } from '@expo/vector-icons';

import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';
import accessibilityImg from '@/assets/images/accessibility.png';

const { width: W, height: H } = Dimensions.get('window');
const H_PAD = W * 0.06;

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
   * current pick and `endDate` is always null. Defaults to false (range mode)
   * so CreateListing2 keeps its existing behavior.
   */
  singleSelect?: boolean;
  /** Popup background opacity from 0 to 1. */
  popupOpacity?: number;
  /** Side gap as a percent of screen width. Example: 5 = 5% on each side. */
  sideMarginPercent?: number;
  onClose: () => void;
  onConfirm: (start: Date, end: Date | null) => void;
}

export default function DateRangePicker({
  visible,
  initialStart = null,
  initialEnd = null,
  helperText = "Tap a start date, then tap an end date.",
  confirmLabel = 'Confirm',
  confirmDisabled = false,
  singleSelect = false,
  popupOpacity = 0.75,
  sideMarginPercent = 0,
  onClose,
  onConfirm,
}: DateRangePickerProps) {
  const slideAnim = useRef(new Animated.Value(H)).current;
  const sideMargin = W * (sideMarginPercent / 100);
  const calendarCellWidth = (W - sideMargin * 2 - H_PAD * 2) / 7;

  const [calendarYear, setCalendarYear] = useState(
    initialStart ? initialStart.getFullYear() : new Date().getFullYear(),
  );
  const [calendarMonth, setCalendarMonth] = useState(
    initialStart ? initialStart.getMonth() : new Date().getMonth(),
  );
  const [pickingStart, setPickingStart] = useState(true);
  const [startDate, setStartDate] = useState<Date | null>(initialStart);
  const [endDate, setEndDate] = useState<Date | null>(initialEnd);

  // Slide-in/out animation
  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : H,
      duration: visible ? 400 : 300,
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
      // Single-pick mode — every tap replaces the selection.
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

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.popup,
        {
          left: sideMargin,
          right: sideMargin,
          backgroundColor: `rgba(0,0,0,${popupOpacity})`,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={styles.helperRow}>
        <Image source={accessibilityImg} style={styles.helperIcon} />
        <Text style={styles.helperText}>{helperText}</Text>
      </View>

      <View style={styles.calendarContainer}>
        {/* Month nav */}
        <View style={styles.navRow}>
          <TouchableOpacity onPress={withLightHaptic(() => stepMonth(-1))}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.monthText}>
            {MONTHS[calendarMonth]} {calendarYear}
          </Text>
          <TouchableOpacity onPress={withLightHaptic(() => stepMonth(1))}>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Day labels */}
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

        <Text style={styles.rangeHint}>{rangeHint}</Text>
      </View>

      <View style={styles.bottomRow}>
        <TouchableOpacity
          style={styles.backCircle}
          onPress={withLightHaptic(onClose)}
          activeOpacity={0.8}
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmBtn, confirmDisabled && { opacity: 0.6 }]}
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
  popup: {
    position: 'absolute',
    bottom: 0,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    paddingTop: W * 0.05,
    paddingBottom: W * 0.06,
    paddingHorizontal: H_PAD,
    minHeight: H * 0.52,
    justifyContent: 'space-between',
  },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: W * 0.02,
    marginBottom: W * 0.04,
  },
  helperIcon: {
    width: 18,
    height: 18,
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
  calendarContainer: { flex: 1 },
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
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: W * 0.02,
  },
  dayLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    width: (W - H_PAD * 2) / 7,
    textAlign: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: (W - H_PAD * 2) / 7,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  cellSelected: { backgroundColor: '#fff' },
  cellRange: { backgroundColor: 'rgba(255,255,255,0.25)' },
  dayText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 13,
    color: '#fff',
  },
  dayTextSelected: {
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#000',
  },
  rangeHint: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginTop: W * 0.02,
    marginBottom: W * 0.02,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: W * 0.03,
    paddingTop: W * 0.03,
  },
  backCircle: {
    width: 50,
    height: 50,
    borderRadius: 100,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtn: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 16,
    color: '#fff',
  },
});
