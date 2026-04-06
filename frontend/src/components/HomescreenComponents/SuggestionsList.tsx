/**
 * SuggestionsList — Tile grid of all active listings.
 *
 * Fetches listings from Supabase and subscribes to realtime changes
 * so new/updated/deleted listings appear instantly without refresh.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Dimensions } from 'react-native';

// ─── Navigation ──────────────────────────────────────────────────────────────
import { useFocusEffect } from '@react-navigation/native';

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Ionicons } from '@expo/vector-icons';

// ─── Supabase ────────────────────────────────────────────────────────────────
import { supabase } from '@/src/utils/supabase';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

const { width: screenWidth } = Dimensions.get('window');
const TILE_GAP = screenWidth * 0.03;
const TILE_WIDTH = (screenWidth - screenWidth * 0.1 - TILE_GAP) / 2; // 2 columns

interface Listing {
  id: string;
  address: string;
  price_per_hour: number;
}

// ─── Component ───────────────────────────────────────────────────────────────
interface SuggestionsListProps {
  refreshKey?: number;
}

export default function SuggestionsList({ refreshKey }: SuggestionsListProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchListings = async () => {
    const { data, error } = await supabase
      .from('listings')
      .select('id, address, price_per_hour')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) console.error('Failed to fetch listings:', error.message);
    else setListings(data ?? []);
    setLoading(false);
  };

  // Re-fetch every time this screen comes into focus (e.g. returning from CreateListing)
  useFocusEffect(
    useCallback(() => {
      fetchListings();
    }, [])
  );

  // Also re-fetch when parent bumps refreshKey (pull-to-refresh)
  useEffect(() => {
    fetchListings();
  }, [refreshKey]);

  useEffect(() => {
    // Subscribe to realtime changes on the listings table
    const channel = supabase
      .channel('listings-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'listings' },
        () => {
          fetchListings();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) {
    return <ActivityIndicator style={{ marginVertical: 16 }} />;
  }

  if (listings.length === 0) {
    return (
      <Text style={styles.emptyText}>No listings yet — be the first to add a spot!</Text>
    );
  }

  return (
    <View style={styles.grid}>
      {listings.map((item) => (
        <View key={item.id} style={styles.tile}>
          <Ionicons name="location-sharp" size={24} color="#4A90D9" style={styles.tileIcon} />
          <Text style={styles.tileAddress} numberOfLines={2}>{item.address}</Text>
          <Text style={styles.tilePrice}>${item.price_per_hour}/hr</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TILE_GAP,
  },
  tile: {
    width: TILE_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: screenWidth * 0.035,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  tileIcon: {
    marginBottom: 8,
  },
  tileAddress: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 14,
    color: '#000',
    marginBottom: 6,
  },
  tilePrice: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 13,
    color: 'rgba(0,0,0,0.55)',
  },
  emptyText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 14,
    color: 'rgba(0,0,0,0.45)',
    textAlign: 'center',
    marginVertical: 16,
  },
});

