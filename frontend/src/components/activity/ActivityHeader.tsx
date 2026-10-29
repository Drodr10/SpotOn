/**
 * ActivityHeader — black title pill on the left, round black back button on the
 * right (Figma 746:6 "Header" + "Navigation Icon").
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { CustomFonts } from '@/src/constants/theme';
import PressableCard from './PressableCard';
import { HEADER_H, SW } from './layout';

export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/Profile' as any);
}

export default function ActivityHeader({ title }: { title: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.pill} accessibilityRole='header'>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <PressableCard
        onPress={goBack}
        hitSlop={8}
        accessibilityLabel='Go back'
        style={styles.back}
      >
        <Ionicons name='arrow-back' size={HEADER_H * 0.5} color='#FFFFFF' />
      </PressableCard>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pill: {
    height: HEADER_H,
    borderRadius: HEADER_H / 2,
    paddingHorizontal: SW * 0.07,
    backgroundColor: '#000000',
    justifyContent: 'center',
    flexShrink: 1,
    marginRight: SW * 0.03,
  },
  title: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.05,
    color: '#FFFFFF',
  },
  back: {
    width: HEADER_H,
    height: HEADER_H,
    borderRadius: HEADER_H / 2,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
