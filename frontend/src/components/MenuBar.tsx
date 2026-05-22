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
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useSegments } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { supabase } from '../utils/supabase';
import { api } from '../utils/api';
import { CustomFonts } from '../constants/theme';

import profileDefault from '../../assets/images/menubar/profile_picture_default.png';
import homeWhite from '../../assets/images/menubar/home_white.png';
import homeBlack from '../../assets/images/menubar/home_black.png';
import messagesWhite from '../../assets/images/menubar/messages_white.png';
import messagesBlack from '../../assets/images/menubar/messages_black.png';
import addWhite from '../../assets/images/menubar/add_white.png';

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

// ─── Timer data ───────────────────────────────────────────────────────────────
type TimerData =
  | { mode: 'months'; months: number }
  | { mode: 'weeks';  weeks: number }
  | { mode: 'days';   days: number; hours: number }
  | { mode: 'hours';  hours: number; mins: number }
  | { mode: 'mins';   mins: number; secs: number };

function formatRemaining(ms: number): TimerData {
  if (ms <= 0) return { mode: 'mins', mins: 0, secs: 0 };
  const totalSecs   = Math.floor(ms / 1000);
  const totalMins   = Math.floor(totalSecs / 60);
  const totalHrs    = Math.floor(totalMins / 60);
  const totalDays   = Math.floor(totalHrs / 24);
  const totalWks    = Math.floor(totalDays / 7);
  const totalMonths = Math.floor(totalWks / 4);
  if (totalMonths >= 1) return { mode: 'months', months: totalMonths };
  if (totalWks    >= 1) return { mode: 'weeks',  weeks: totalWks };
  if (totalDays   >= 1) return { mode: 'days',   days: totalDays, hours: totalHrs % 24 };
  if (totalHrs    >= 1) return { mode: 'hours',  hours: totalHrs, mins: totalMins % 60 };
  return { mode: 'mins', mins: totalMins, secs: totalSecs % 60 };
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
      const url = (user.user_metadata as any)?.avatar_url ?? null;
      setAvatarUrl(url);
      const res = await api.getActiveReservation(user.id);
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

  const handlePress = (key: TabKey) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const animation = slideFor(key);
    if (key === 'profile')  router.push({ pathname: '/Profile',       params: { animation } } as any);
    else if (key === 'home')     router.push({ pathname: '/Homescreen',    params: { animation } } as any);
    else if (key === 'messages') router.push({ pathname: '/Messages',      params: { animation } } as any);
    else if (key === 'add')      router.push({ pathname: '/CreateListing2', params: { animation } } as any);
  };

  if (!visible) return null;

  const addIconSize = Math.round(barH * ADD_ICON_RATIO);

  return (
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
});
