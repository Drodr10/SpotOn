/** Empty / error / loading notes shared by the Activity and Seller Account pages. */

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { CustomFonts } from '@/src/constants/theme';
import PressableCard from './PressableCard';
import { SW } from './layout';

export function EmptyNote({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

export function LoadingNote() {
  return (
    <View style={styles.loading} accessibilityLabel='Loading'>
      <ActivityIndicator color='#000' />
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
      <PressableCard onPress={onRetry} style={styles.retry} accessibilityLabel='Try again'>
        <Text style={styles.retryText}>Try again</Text>
      </PressableCard>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.038,
    color: 'rgba(0,0,0,0.6)',
    textAlign: 'center',
    paddingVertical: SW * 0.02,
  },
  loading: { paddingVertical: SW * 0.08, alignItems: 'center' },
  errorBox: { alignItems: 'center', gap: SW * 0.04, paddingVertical: SW * 0.06 },
  errorText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.04,
    color: 'rgba(0,0,0,0.7)',
    textAlign: 'center',
  },
  retry: {
    height: SW * 0.11,
    paddingHorizontal: SW * 0.08,
    borderRadius: 999,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.04,
    color: '#fff',
  },
});
