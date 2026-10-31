/**
 * PillMenu — the small white dropdown that hangs off a black header pill
 * (originally Chat's name pill, Figma 724:54 / 787:210). Reused by Chat,
 * Activity Details and Profile.
 *
 * Pieces:
 *  - PillMenuPanel    the animated white panel (positioned inside the pill's wrapper)
 *  - PillMenuBackdrop full-screen tap-away catcher; screens render it as a sibling
 *                     *below* the header (zIndex 10 vs the header's 20)
 *  - PillMenu         convenience wrapper: wrapper View + panel + tappable pill with a
 *                     chevron. Chat renders its own pill and uses the panel directly.
 *
 * Panel is rendered *before* the pill so the pill paints over its top edge — it reads
 * as sliding out from behind the pill. If the panel has to be wider than the pill
 * (long labels under a short pill) it detaches: rounded on all corners with a small gap.
 *
 * Motion (animate-expo / apple-design):
 *  - Enter: spring (duration 300, dampingRatio 1 — no overshoot, it's a deliberate menu)
 *    on opacity + scale 0.92 → 1 + a small translateY, origin at the TOP (the pill).
 *  - Exit: 120ms ease-out, faster than the entrance. Unmounts when the exit finishes.
 *  - Only transform + opacity, on the UI thread. Reduced motion: opacity-only fade.
 *
 * Android only hit-tests inside a parent's bounds, so the pill wrapper and the header
 * row need `paddingBottom: overhang` + `marginBottom: -overhang` (layout unchanged).
 * `menuOverhang(items)` gives that value; `pillMenuHostStyle(items)` is the style.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic } from '@/src/utils/haptics';

const { width: screenWidth } = Dimensions.get('window');

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const DESTRUCTIVE = '#C62828';

export interface PillMenuItem {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  destructive?: boolean;
  /** Greyed out and not tappable; pair with `subtitle` to say why. */
  disabled?: boolean;
  /** Small second line under the label. */
  subtitle?: string;
  /** Shows a spinner in place of the icon and ignores taps. */
  busy?: boolean;
  onPress: () => void;
}

/** Horizontal inset from the pill's edges — keeps the white from peeking round the pill's curved ends. */
const INSET = screenWidth * 0.025;
export const PILL_MENU_ROW_HEIGHT = Math.max(48, screenWidth * 0.125);
const SUBTITLE_EXTRA = screenWidth * 0.035;
const DETACH_GAP = 8;

/** Overhang for a fixed number of plain rows (Chat's two-row menu). */
export const pillMenuOverhang = (rows: number) => PILL_MENU_ROW_HEIGHT * rows + 24;

/** Overhang for an arbitrary item list, with room for the detached gap. */
export function menuOverhang(items: PillMenuItem[]) {
  const extra = items.reduce((n, i) => n + (i.subtitle ? SUBTITLE_EXTRA : 0), 0);
  return pillMenuOverhang(items.length) + extra + DETACH_GAP;
}

/** Host style from a plain row count (no subtitles) — for screens whose item list closes over refs. */
export function pillMenuHostStyleForRows(rows: number): ViewStyle {
  const o = pillMenuOverhang(rows) + DETACH_GAP;
  return { paddingBottom: o, marginBottom: -o };
}

/** Style for both the pill wrapper and the header row that contains it. */
export function pillMenuHostStyle(items: PillMenuItem[]): ViewStyle {
  const o = menuOverhang(items);
  return { paddingBottom: o, marginBottom: -o };
}

interface PanelProps {
  open: boolean;
  /** Pill dimensions, so the panel can tuck behind it and match its width. */
  pillWidth: number;
  pillHeight: number;
  items: PillMenuItem[];
  /** Minimum panel width; if larger than the pill the panel detaches. */
  minWidth?: number;
  /** Called right before an item's onPress (use to close the menu). */
  onClose?: () => void;
}

export function PillMenuPanel({ open, pillWidth, pillHeight, items, minWidth = 0, onClose }: PanelProps) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const [mounted, setMounted] = useState(open);

  const unmount = useCallback(() => setMounted(false), []);

  // Mount as soon as we're asked to open (derived during render, not synced in an effect).
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      progress.set(
        reduced
          ? withTiming(1, { duration: 150, easing: EASE_OUT })
          : withSpring(1, { duration: 300, dampingRatio: 1 }),
      );
    } else {
      progress.set(
        withTiming(0, { duration: reduced ? 100 : 120, easing: EASE_OUT }, (finished) => {
          if (finished) scheduleOnRN(unmount);
        }),
      );
    }
  }, [open, reduced, progress, unmount]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.get();
    if (reduced) return { opacity: p };
    return {
      opacity: Math.min(1, Math.max(0, p)),
      transform: [{ translateY: (1 - p) * -10 }, { scale: 0.92 + 0.08 * p }],
    };
  });

  if (!mounted || pillWidth <= 0) return null;

  const tuckedWidth = Math.max(pillWidth - INSET * 2, 0);
  const detached = minWidth > tuckedWidth;
  const panelWidth = detached ? minWidth : tuckedWidth;
  // Tucked: the top ~60% of the pill's height hides behind the pill.
  const overlap = detached ? 0 : pillHeight * 0.6;

  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      style={[
        styles.panel,
        detached && styles.panelDetached,
        {
          top: pillHeight - overlap + (detached ? DETACH_GAP : 0),
          left: detached ? 0 : INSET,
          width: panelWidth,
          paddingTop: detached ? 6 : overlap + 4,
          transformOrigin: detached ? '20% 0%' : '50% 0%',
        },
        animatedStyle,
      ]}
    >
      {items.map((item, i) => {
        const inactive = item.disabled || item.busy;
        const color = item.destructive ? DESTRUCTIVE : '#000';
        return (
          <Pressable
            key={item.key}
            onPress={() => {
              if (inactive) return;
              onClose?.();
              item.onPress();
            }}
            disabled={inactive}
            accessibilityRole="menuitem"
            accessibilityLabel={item.subtitle ? `${item.label}. ${item.subtitle}` : item.label}
            accessibilityState={{ disabled: !!inactive }}
            style={({ pressed }) => [
              styles.row,
              item.subtitle ? styles.rowTall : null,
              i > 0 && styles.rowDivider,
              pressed && styles.rowPressed,
              item.disabled && styles.rowDisabled,
            ]}
          >
            {item.busy ? (
              <ActivityIndicator size="small" color={color} />
            ) : (
              <Ionicons name={item.icon} size={screenWidth * 0.045} color={color} />
            )}
            <View style={styles.labelWrap}>
              <Text style={[styles.label, item.destructive && styles.labelDestructive]} numberOfLines={1}>
                {item.label}
              </Text>
              {!!item.subtitle && (
                <Text style={styles.subtitle} numberOfLines={2}>
                  {item.subtitle}
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

/** Full-screen tap-away catcher. Render below the header (header zIndex 20). */
export function PillMenuBackdrop({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      style={styles.backdrop}
      onPress={onPress}
      accessibilityLabel="Close menu"
      accessibilityRole="button"
    />
  );
}

interface PillMenuProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  items: PillMenuItem[];
  /** Pill contents (text / icon). A chevron is appended. */
  children: React.ReactNode;
  accessibilityLabel: string;
  pillStyle: StyleProp<ViewStyle>;
  minPanelWidth?: number;
  chevronSize?: number;
  wrapStyle?: StyleProp<ViewStyle>;
}

export default function PillMenu({
  open,
  onToggle,
  onClose,
  items,
  children,
  accessibilityLabel,
  pillStyle,
  minPanelWidth,
  chevronSize = screenWidth * 0.04,
  wrapStyle,
}: PillMenuProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  return (
    <View style={[styles.wrap, pillMenuHostStyle(items), wrapStyle]} pointerEvents="box-none">
      <PillMenuPanel
        open={open}
        pillWidth={size.width}
        pillHeight={size.height}
        items={items}
        minWidth={minPanelWidth}
        onClose={onClose}
      />
      <Pressable
        onPress={() => {
          triggerLightHaptic();
          onToggle();
        }}
        onLayout={(e) =>
          setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
        style={({ pressed }) => [pillStyle, styles.pillRow, pressed && styles.pillPressed]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
      >
        {children}
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={chevronSize}
          color="rgba(255,255,255,0.7)"
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', alignSelf: 'flex-start', flexShrink: 1 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: screenWidth * 0.02 },
  pillPressed: { opacity: 0.8 },
  panel: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    paddingBottom: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 0,
  },
  panelDetached: { borderRadius: 22 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: screenWidth * 0.025,
    height: PILL_MENU_ROW_HEIGHT,
    paddingHorizontal: screenWidth * 0.04,
  },
  rowTall: { height: PILL_MENU_ROW_HEIGHT + SUBTITLE_EXTRA },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.12)',
  },
  rowPressed: { backgroundColor: 'rgba(0,0,0,0.05)' },
  rowDisabled: { opacity: 0.45 },
  labelWrap: { flexShrink: 1 },
  label: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.04,
    color: '#000',
  },
  labelDestructive: { color: DESTRUCTIVE },
  subtitle: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.03,
    color: 'rgba(0,0,0,0.6)',
    marginTop: 1,
  },
});
