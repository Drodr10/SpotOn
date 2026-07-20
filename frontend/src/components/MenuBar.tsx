/**
 * MenuBar — floating bottom navigation bar.
 *
 * Solid black pill containing: profile avatar, home icon, messages, add (+) button.
 * Expands left when the user has an active reservation to show a live countdown timer.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useSegments } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { supabase } from '../utils/supabase';
import { api } from '../utils/api';
import { CustomFonts } from '../constants/theme';
import { type TimerData, formatRemaining } from '../utils/timeFormat';

import profileDefault from '../../assets/images/temprofileicon.png';
import homeWhite from '../../assets/images/menubar/home_white.png';
import homeBlack from '../../assets/images/menubar/home_black.png';
import messagesWhite from '../../assets/images/menubar/messages_white.png';
import messagesBlack from '../../assets/images/menubar/messages_black.png';
import addWhite from '../../assets/images/menubar/add_white.png';
import spotonLogoCircle from '../../assets/images/spotonlogocircle.png';

// ═════════════════════════════════════════════════════════════════════════════
// ▼▼▼ SIZE CONTROLS ▼▼▼
// ═════════════════════════════════════════════════════════════════════════════

const BAR_HEIGHT     = 85;
const BAR_HEIGHT_MIN = 60;
const MAX_WIDTH_PCT  = 0.9;
const ICON_RATIO     = 0.72;
const ADD_ICON_RATIO = 0.72;
const PROFILE_RATIO  = 0.7;
const SHIFTER_RATIO  = 0.82;
const H_PADDING_RATIO = 0.28;
const ICON_SLOT_RATIO = 0.95;
const TIMER_RATIO    = 1.25;  // width of the timer section as fraction of bar height
const ADD_GAP_RATIO  = 0.2;   // gap between main bar and add circle as fraction of bar height
const BOTTOM_OFFSET  = 0;

// ═════════════════════════════════════════════════════════════════════════════

export const MENU_BAR_HEIGHT = BAR_HEIGHT;

type TabKey = 'profile' | 'home' | 'messages' | 'add';

const VISIBLE_ROUTES = new Set(['Homescreen', 'Profile', 'Messages']);

const TAB_ORDER: Record<TabKey, number> = {
  profile: 0,
  home: 1,
  messages: 2,
  add: 2, // add is outside the bar; use messages position as fallback for slide direction
};

function routeToTab(route: string | undefined): TabKey | null {
  if (!route) return null;
  if (route === 'Profile') return 'profile';
  if (route === 'Homescreen') return 'home';
  if (route === 'Messages') return 'messages';
  return null;
}

function computeDims(height: number) {
  const iconSize    = Math.round(height * ICON_RATIO);
  const profileSize = Math.round(height * PROFILE_RATIO);
  const shifterSize = Math.round(height * SHIFTER_RATIO);
  const hPad        = Math.round(height * H_PADDING_RATIO);
  const slot        = Math.round(height * ICON_SLOT_RATIO);
  const timerW      = Math.round(height * TIMER_RATIO);
  const addGap      = Math.round(height * ADD_GAP_RATIO);
  const baseW       = hPad * 2 + slot * 3;
  return { iconSize, profileSize, shifterSize, hPad, slot, timerW, addGap, baseW };
}

function fitHeight(screenW: number, hasTimer: boolean): number {
  const maxBarW = screenW * MAX_WIDTH_PCT;
  let h = BAR_HEIGHT;
  while (h > BAR_HEIGHT_MIN) {
    const { baseW, timerW, addGap } = computeDims(h);
    // total width = main pill + timer + gap + add circle (add circle is always h×h)
    const w = baseW + (hasTimer ? timerW : 0) + addGap + h;
    if (w <= maxBarW) return h;
    h -= 1;
  }
  return BAR_HEIGHT_MIN;
}

// ─── Rolling digit ────────────────────────────────────────────────────────────
function RollingChar({ char, style }: { char: string; style: any }) {
  const prev = useRef(char);
  const anim = useRef(new Animated.Value(0)).current;
  const [pair, setPair] = useState<[string, string]>([char, char]);
  const fs   = style.fontSize ?? 14;
  const lineH = fs + 2;

  useEffect(() => {
    if (prev.current === char) return;
    setPair([prev.current, char]);
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => { prev.current = char; });
    Haptics.selectionAsync().catch(() => {});
  }, [char]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -lineH] });

  return (
    <View style={{ height: lineH, overflow: 'hidden' }}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        <Text style={[style, { height: lineH, lineHeight: lineH }]}>{pair[0]}</Text>
        <Text style={[style, { height: lineH, lineHeight: lineH }]}>{pair[1]}</Text>
      </Animated.View>
    </View>
  );
}

function RollingText({ text, style }: { text: string; style: any }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {text.split('').map((c, i) => (
        <RollingChar key={i} char={c} style={style} />
      ))}
    </View>
  );
}

// ─── Timer content ────────────────────────────────────────────────────────────
function TimerContent({ timer, barH }: { timer: TimerData; barH: number }) {
  const large: any = {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: Math.round(barH * 0.25),
    color: '#fff',
  };
  const small: any = {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: Math.round(barH * 0.21),
    color: '#fff',
  };
  const lbl: any = {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: Math.round(barH * 0.13),
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 0.3,
  };

  if (timer.mode === 'months') {
    return (
      <View style={tcStyles.row}>
        <RollingText text={String(timer.months)} style={large} />
        <Text style={[lbl, { marginLeft: 4, marginBottom: 1 }]}>mnth</Text>
      </View>
    );
  }

  if (timer.mode === 'weeks') {
    return (
      <View style={tcStyles.row}>
        <RollingText text={String(timer.weeks)} style={large} />
        <Text style={[lbl, { marginLeft: 4, marginBottom: 1 }]}>wks</Text>
      </View>
    );
  }

  if (timer.mode === 'days') {
    return (
      <View style={tcStyles.stack}>
        <View style={tcStyles.row}>
          <RollingText text={String(timer.days)} style={small} />
          <Text style={[lbl, { marginLeft: 3 }]}>dys</Text>
        </View>
        <View style={tcStyles.row}>
          <RollingText text={String(timer.hours)} style={small} />
          <Text style={[lbl, { marginLeft: 3 }]}>hrs</Text>
        </View>
      </View>
    );
  }

  // hours or mins — clock format XX:XX with labels below
  const leftVal  = timer.mode === 'hours'
    ? String(timer.hours).padStart(2, '0')
    : String(timer.mins).padStart(2, '0');
  const rightVal = timer.mode === 'hours'
    ? String(timer.mins).padStart(2, '0')
    : String(timer.secs).padStart(2, '0');
  const leftLbl  = timer.mode === 'hours' ? 'hrs' : 'min';
  const rightLbl = timer.mode === 'hours' ? 'min' : 'sec';

  return (
    <View style={tcStyles.clock}>
      <View style={tcStyles.row}>
        <RollingText text={leftVal} style={large} />
        <Text style={[large, { opacity: 0.4, marginHorizontal: 1 }]}>:</Text>
        <RollingText text={rightVal} style={large} />
      </View>
      <Text style={lbl}>{leftLbl} : {rightLbl}</Text>
    </View>
  );
}

const tcStyles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'baseline' },
  stack: { flexDirection: 'column', gap: 2 },
  clock: { flexDirection: 'column', alignItems: 'flex-start' },
});

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function MenuBar() {
  const insets      = useSafeAreaInsets();
  const segments    = useSegments() as string[];
  const currentRoute = segments[segments.length - 1];
  const visible     = VISIBLE_ROUTES.has(currentRoute);

  const [activeTab, setActiveTab] = useState<TabKey>(routeToTab(currentRoute) ?? 'home');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [endTime, setEndTime]     = useState<Date | null>(null);
  const [now, setNow]             = useState<number>(Date.now());
  const [screenW, setScreenW]     = useState(Dimensions.get('window').width);

  // ── Payout-info popup (shown when tapping + before entering the create flow) ──
  const [showAddInfo, setShowAddInfo] = useState(false);
  const addInfoAnim   = useRef(new Animated.Value(Dimensions.get('window').height)).current;
  const addInfoBackdrop = useRef(new Animated.Value(0)).current;
  // Slide direction to hand off to the create-listing route once the user continues.
  const addInfoSlide  = useRef<'slide_from_left' | 'slide_from_right'>('slide_from_right');

  const openAddInfo = (animation: 'slide_from_left' | 'slide_from_right') => {
    addInfoSlide.current = animation;
    addInfoAnim.setValue(Dimensions.get('window').height);
    setShowAddInfo(true);
    Animated.parallel([
      // Spring to match the springy feel of the other card popups in the app.
      Animated.spring(addInfoAnim, {
        toValue: 0,
        damping: 14,
        stiffness: 130,
        mass: 1,
        useNativeDriver: true,
      }),
      Animated.timing(addInfoBackdrop, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const closeAddInfo = (cb?: () => void) => {
    Animated.parallel([
      Animated.spring(addInfoAnim, {
        toValue: Dimensions.get('window').height,
        damping: 14,
        stiffness: 130,
        mass: 1,
        useNativeDriver: true,
      }),
      Animated.timing(addInfoBackdrop, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShowAddInfo(false);
      cb?.();
    });
  };

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setScreenW(window.width));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const t = routeToTab(currentRoute);
    if (t) setActiveTab(t);
  }, [currentRoute]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (cancelled || !user) return;

      // Avatar lives in profiles.avatar_url — that's the source of truth the
      // Profile page writes to. Falls through to temprofileicon if not set.
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setAvatarUrl((profileRow?.avatar_url as string | null) ?? null);

      const res = await api.getInProgressReservation(user.id);
      if (cancelled) return;
      if (res?.endTime) setEndTime(new Date(res.endTime));
      else setEndTime(null);
    })();
    return () => { cancelled = true; };
  }, [currentRoute]);

  // Tick every second when active so seconds countdown is accurate.
  useEffect(() => {
    if (!endTime) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endTime]);

  const remainingMs = endTime ? endTime.getTime() - now : 0;
  const hasActive   = !!endTime && remainingMs > 0;
  const timer       = useMemo(() => formatRemaining(remainingMs), [remainingMs]);

  const barH        = fitHeight(screenW, hasActive);
  const D           = computeDims(barH);
  const targetWidth = D.baseW + (hasActive ? D.timerW : 0);

  // Shifter x position
  const tabIndex        = TAB_ORDER[activeTab];
  const clusterOffset   = hasActive ? D.timerW : 0;
  const targetShifterX  =
    clusterOffset + D.hPad + tabIndex * D.slot + (D.slot - D.shifterSize) / 2;

  const shifterX = useRef(new Animated.Value(targetShifterX)).current;
  useEffect(() => {
    Animated.spring(shifterX, {
      toValue: targetShifterX,
      tension: 120,
      friction: 14,
      useNativeDriver: true,
    }).start();
  }, [targetShifterX]);

  // Bar width expands first, timer fades in after.
  const widthAnim    = useRef(new Animated.Value(targetWidth)).current;
  const timerOpacity = useRef(new Animated.Value(hasActive ? 1 : 0)).current;
  useEffect(() => {
    // Fade out immediately on collapse, then contract width.
    // Expand width first, then fade timer in.
    if (hasActive) {
      timerOpacity.setValue(0);
      Animated.timing(widthAnim, {
        toValue: targetWidth,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(() => {
        Animated.timing(timerOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
    } else {
      Animated.timing(timerOpacity, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }).start(() => {
        Animated.timing(widthAnim, {
          toValue: targetWidth,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
      });
    }
  }, [targetWidth, hasActive]);

  const scales = {
    profile:  useRef(new Animated.Value(1)).current,
    home:     useRef(new Animated.Value(1)).current,
    messages: useRef(new Animated.Value(1)).current,
    add:      useRef(new Animated.Value(1)).current,
  };
  const pressIn  = (key: TabKey) =>
    Animated.spring(scales[key], { toValue: 0.88, tension: 300, friction: 14, useNativeDriver: true }).start();
  const pressOut = (key: TabKey) =>
    Animated.spring(scales[key], { toValue: 1,    tension: 300, friction: 14, useNativeDriver: true }).start();

  const slideFor = (target: TabKey): 'slide_from_left' | 'slide_from_right' =>
    TAB_ORDER[target] < tabIndex ? 'slide_from_left' : 'slide_from_right';

  const handlePress = async (key: TabKey) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const animation = slideFor(key);

    if (key === 'add') {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        Alert.alert('Not Logged In', 'You need to be logged in to create a listing.');
        return;
      }

      // Zero-friction listing: no Stripe account required up front. Show a quick
      // heads-up about deferred payout setup, then enter the create-listing flow.
      openAddInfo(animation);
      return;
    }

    if (key === 'profile')  router.push({ pathname: '/Profile',       params: { animation } } as any);
    else if (key === 'home')     router.push({ pathname: '/Homescreen',    params: { animation } } as any);
    else if (key === 'messages') router.push({ pathname: '/Messages',      params: { animation } } as any);
    else if (key === 'add')      router.push({ pathname: '/CreateListing2', params: { animation } } as any);
  };

  if (!visible) return null;

  const addIconSize = Math.round(barH * ADD_ICON_RATIO);

  const W = screenW;

  return (
    <>
    <View pointerEvents="box-none" style={[styles.wrapper, { bottom: insets.bottom + BOTTOM_OFFSET }]}>
      <View style={styles.barRow}>
        {/* Main pill — profile, home, messages */}
        <Animated.View
          style={[
            styles.bar,
            { width: widthAnim, height: barH, borderRadius: barH / 2 },
          ]}
        >
          {/* Timer (left side) — fades in after width expansion */}
          {hasActive && (
            <Animated.View
              style={[
                styles.timerWrap,
                { left: D.hPad, width: D.timerW - D.hPad * 0.4, opacity: timerOpacity },
              ]}
            >
              <TimerContent timer={timer} barH={barH} />
              <View style={[styles.divider, { right: 0, top: barH * 0.2, bottom: barH * 0.2 }]} />
            </Animated.View>
          )}

          {/* White shifter circle */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.shifter,
              {
                width: D.shifterSize,
                height: D.shifterSize,
                borderRadius: D.shifterSize / 2,
                top: (barH - D.shifterSize) / 2,
                transform: [{ translateX: shifterX }],
              },
            ]}
          />

          {/* Icon cluster — profile, home, messages */}
          <View style={[styles.iconRow, { left: clusterOffset + D.hPad, height: barH }]}>
            {/* Profile */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPressIn={() => pressIn('profile')}
              onPressOut={() => pressOut('profile')}
              onPress={() => handlePress('profile')}
              style={{ width: D.slot, height: barH, alignItems: 'center', justifyContent: 'center' }}
            >
              <Animated.View style={{ transform: [{ scale: scales.profile }] }}>
                <Image
                  source={avatarUrl ? { uri: avatarUrl } : profileDefault}
                  style={{ width: D.profileSize, height: D.profileSize, borderRadius: D.profileSize / 2 }}
                />
              </Animated.View>
            </TouchableOpacity>

            {/* Home */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPressIn={() => pressIn('home')}
              onPressOut={() => pressOut('home')}
              onPress={() => handlePress('home')}
              style={{ width: D.slot, height: barH, alignItems: 'center', justifyContent: 'center' }}
            >
              <Animated.View style={{ transform: [{ scale: scales.home }] }}>
                <Image
                  source={activeTab === 'home' ? homeBlack : homeWhite}
                  style={{ width: D.iconSize, height: D.iconSize }}
                  resizeMode="contain"
                />
              </Animated.View>
            </TouchableOpacity>

            {/* Messages */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPressIn={() => pressIn('messages')}
              onPressOut={() => pressOut('messages')}
              onPress={() => handlePress('messages')}
              style={{ width: D.slot, height: barH, alignItems: 'center', justifyContent: 'center' }}
            >
              <Animated.View style={{ transform: [{ scale: scales.messages }] }}>
                <Image
                  source={activeTab === 'messages' ? messagesBlack : messagesWhite}
                  style={{ width: D.iconSize, height: D.iconSize }}
                  resizeMode="contain"
                />
              </Animated.View>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Separate add button — own black circle at same height */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPressIn={() => pressIn('add')}
          onPressOut={() => pressOut('add')}
          onPress={() => handlePress('add')}
          style={[
            styles.addCircle,
            {
              width: barH,
              height: barH,
              borderRadius: barH / 2,
              marginLeft: D.addGap,
            },
          ]}
        >
          <Animated.View style={{ transform: [{ scale: scales.add }] }}>
            <Image
              source={addWhite}
              style={{ width: addIconSize, height: addIconSize }}
              resizeMode="contain"
            />
          </Animated.View>
        </TouchableOpacity>
      </View>
    </View>

    {/* Payout-info popup — slides up when tapping +, mirrors the create-listing
        rate popups (black card, Continue button). */}
    <Modal visible={showAddInfo} transparent animationType="none" onRequestClose={() => closeAddInfo()}>
      <Animated.View style={[styles.addInfoBackdrop, { opacity: addInfoBackdrop }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => closeAddInfo()} />
      </Animated.View>

      <Animated.View
        style={[
          styles.addInfoCard,
          {
            bottom: W * 0.05 + insets.bottom,
            paddingTop: W * 0.055,
            paddingBottom: W * 0.045,
            paddingHorizontal: W * 0.06,
            borderRadius: W * 0.07,
            transform: [{ translateY: addInfoAnim }],
          },
        ]}
      >
        <Image
          source={spotonLogoCircle}
          style={[styles.addInfoLogo, { width: W * 0.075, height: W * 0.075, top: W * 0.05, right: W * 0.06 }]}
          resizeMode="contain"
        />

        <Text style={[styles.addInfoTitle, { fontSize: W * 0.055, marginBottom: W * 0.03, marginTop: W * 0.005 }]}>
          List now, get paid later
        </Text>
        <Text style={[styles.addInfoBody, { fontSize: W * 0.036, lineHeight: W * 0.052, marginBottom: W * 0.055 }]}>
          You can create your listing and start earning right away — no business account needed. When your first booking
          comes in, we'll ask for a few quick payout details so your money goes straight to your bank.
        </Text>

        <TouchableOpacity
          style={[styles.addInfoContinue, { height: W * 0.12, borderRadius: W * 0.06 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            closeAddInfo(() =>
              router.push({ pathname: '/CreateListing2', params: { animation: addInfoSlide.current } } as any)
            );
          }}
          activeOpacity={0.8}
        >
          <Text style={[styles.addInfoContinueText, { fontSize: W * 0.04 }]}>Continue</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
    elevation: 20,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bar: {
    backgroundColor: '#000',
    overflow: 'hidden',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
  },
  addCircle: {
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
  },
  iconRow: {
    position: 'absolute',
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  shifter: {
    position: 'absolute',
    backgroundColor: '#fff',
    left: 0,
  },
  timerWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  divider: {
    position: 'absolute',
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },

  // ── Payout-info popup ────────────────────────────────────────────────────────
  addInfoBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  addInfoCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#000',
    zIndex: 20,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  addInfoLogo: {
    position: 'absolute',
    opacity: 0.9,
    zIndex: 1,
  },
  addInfoTitle: {
    fontFamily: CustomFonts.BevellierMedium,
    color: '#fff',
  },
  addInfoBody: {
    fontFamily: CustomFonts.SwitzerLight,
    color: 'rgba(255,255,255,0.75)',
  },
  addInfoContinue: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addInfoContinueText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#fff',
  },
});
