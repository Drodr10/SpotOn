
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../utils/supabase';
import { CustomFonts } from '@/src/constants/theme';

const { width: screenWidth } = Dimensions.get('window');

interface Conversation {
  id: string;
  renter_id: string;
  owner_id: string;
  last_message: string | null;
  updated_at: string;
  otherUserName: string;
  otherUserId: string;
}

export default function MessagesScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getClaims().then(async ({ data }) => {
      if (!data) { setLoading(false); return; }
      const userId = data.claims.sub;

      const { data: convData, error } = await supabase
        .from('conversations')
        .select('*')
        .or(`renter_id.eq.${userId},owner_id.eq.${userId}`)
        .order('updated_at', { ascending: false });

      if (error || !convData || convData.length === 0) {
        setLoading(false);
        return;
      }

      // Fetch names for all other participants
      const otherIds = [...new Set(convData.map((c: any) =>
        c.renter_id === userId ? c.owner_id : c.renter_id
      ))];

      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', otherIds);

      const profileMap: Record<string, string> = Object.fromEntries(
        (profileData ?? []).map((p: any) => [p.id, p.full_name])
      );

      const enriched: Conversation[] = convData.map((c: any) => {
        const otherId = c.renter_id === userId ? c.owner_id : c.renter_id;
        return { ...c, otherUserName: profileMap[otherId] ?? 'Unknown', otherUserId: otherId };
      });

      setConversations(enriched);
      setLoading(false);
    });
  }, []);

  const renderItem = ({ item }: { item: Conversation }) => (
    <TouchableOpacity
      style={styles.convRow}
      onPress={() =>
        router.push({
          pathname: './Chat',
          params: { conversationId: item.id, otherUserName: item.otherUserName },
        } as any)
      }
      activeOpacity={0.7}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{item.otherUserName.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.convInfo}>
        <Text style={styles.convName}>{item.otherUserName}</Text>
        <Text style={styles.convLast} numberOfLines={1}>
          {item.last_message ?? 'No messages yet'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={screenWidth * 0.05} color="rgba(0,0,0,0.3)" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={screenWidth * 0.06} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Messages</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#000" style={styles.loader} />
      ) : conversations.length === 0 ? (
        <Text style={styles.empty}>No conversations yet</Text>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#DCDBD8' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: screenWidth * 0.04,
    paddingVertical: screenWidth * 0.03,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.12)',
  },
  backBtn: { marginRight: screenWidth * 0.03 },
  headerTitle: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.05,
    color: '#000',
  },
  loader: { marginTop: 40 },
  empty: {
    textAlign: 'center',
    marginTop: 60,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.04,
    color: 'rgba(0,0,0,0.5)',
  },
  list: { paddingTop: screenWidth * 0.02 },
  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: screenWidth * 0.05,
    paddingVertical: screenWidth * 0.04,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  avatar: {
    width: screenWidth * 0.11,
    height: screenWidth * 0.11,
    borderRadius: 999,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: screenWidth * 0.04,
  },
  avatarText: {
    color: '#fff',
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.045,
  },
  convInfo: { flex: 1 },
  convName: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.04,
    color: '#000',
    marginBottom: 2,
  },
  convLast: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.033,
    color: 'rgba(0,0,0,0.5)',
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.08)',
    marginLeft: screenWidth * 0.05 + screenWidth * 0.11 + screenWidth * 0.04,
  },
});
