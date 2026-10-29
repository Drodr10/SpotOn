/**
 * SectionTab — white label pill that bleeds off the left screen edge
 * ("Active" / "Scheduled" / "Past" in Figma 746:6).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CustomFonts } from '@/src/constants/theme';
import { H_PAD, SW } from './layout';

export default function SectionTab({ label }: { label: string }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.pill} accessibilityRole='header'>
        <Text style={styles.label}>{label}</Text>
      </View>
    </View>
  );
}

const TAB_H = SW * 0.085;

const styles = StyleSheet.create({
  // Cancels the screen's horizontal padding so the pill touches the left edge.
  wrap: { marginLeft: -H_PAD, alignItems: 'flex-start' },
  pill: {
    height: TAB_H,
    minWidth: SW * 0.32,
    paddingLeft: SW * 0.06,
    paddingRight: SW * 0.06,
    backgroundColor: '#FFFFFF',
    borderTopRightRadius: TAB_H / 2,
    borderBottomRightRadius: TAB_H / 2,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  label: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.045,
    color: '#000000',
  },
});
