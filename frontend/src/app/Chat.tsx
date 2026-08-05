/**
 * Chat — inside a conversation (Figma 724:54 "Inside Messaging").
 *
 * The top-left title becomes a dark pill carrying the other participant's own
 * profile picture + name (replacing the "Messages" title). A black circular
 * back button sits in the top-right. Messages render as tailed bubbles —
 * received on the left, sent on the right — and the composer is a full-width
 * pill with an aura-gradient send button. The global floating MenuBar stays at
 * the bottom (Chat is registered as a visible route).
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  ImageBackground,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../utils/supabase';
import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';

import defaultAvatar from '@/assets/images/temprofileicon.png';
import auraGradient from '@/assets/images/profilePage/aura_gradient.png';

const { width: screenWidth } = Dimensions.get('window');

const HEADER_BTN_HEIGHT = screenWidth * 0.12;
const HEADER_AVATAR = screenWidth * 0.08;
const SEND_SIZE = screenWidth * 0.11;
const NAV_SIZE = screenWidth * 0.09;

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  sent_at: string;
}

// Booking-confirmation auto-messages embed the listing address; surface a
// navigate button that opens the maps app — the Figma "opens up navigation
// app with the location of the address" bubble.
const BOOKING_RE = /Booking confirmed:\s*(.+?)\s*·/i;

function extractAddress(content: string): string | null {
  const m = content.match(BOOKING_RE);
  return m ? m[1] : null;
}

function openMaps(address: string) {
  const encoded = encodeURIComponent(address);
  const url = Platform.select({
    ios: `maps://maps.apple.com/?q=${encoded}`,
    android: `geo:0,0?q=${encoded}`,
    default: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  })!;
  Linking.openURL(url);
}

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { conversationId, otherUserName, returnToHome } = useLocalSearchParams<{
    conversationId: string;
    otherUserName: string;
    returnToHome?: string;
  }>();

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [headerName, setHeaderName] = useState<string>(otherUserName ?? 'Chat');
  const [headerAvatar, setHeaderAvatar] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    supabase.auth.getClaims().then(({ data }) => {
      if (data) setCurrentUserId(data.claims.sub);
    });
  }, []);

  // Keyboard visibility — lets the composer tuck above the floating MenuBar
  // when idle, and sit flush above the keyboard while typing.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, () => setKeyboardVisible(true));
    const h = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
    return () => {
      s.remove();
      h.remove();
    };
  }, []);

  // Resolve the other participant's own profile picture + name for the header.
  useEffect(() => {
    if (!conversationId || !currentUserId) return;
    (async () => {
      const { data: conv } = await supabase
        .from('conversations')
        .select('renter_id, owner_id')
        .eq('id', conversationId)
        .maybeSingle();
      if (!conv) return;
      const otherId =
        conv.renter_id === currentUserId ? conv.owner_id : conv.renter_id;
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', otherId)
        .maybeSingle();
      if (profile) {
        setHeaderName(profile.full_name ?? otherUserName ?? 'Chat');
        setHeaderAvatar(profile.avatar_url ?? null);
      }
    })();
  }, [conversationId, currentUserId]);

  useEffect(() => {
    if (!conversationId) return;

    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true })
      .then(({ data }) => {
        if (data) setMessages(data);
      });

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !currentUserId || !conversationId) return;
    triggerLightHaptic();
    const content = newMessage.trim();
    setNewMessage('');

    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: currentUserId,
      content,
    });

    await supabase
      .from('conversations')
      .update({ last_message: content, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  };

  const handleBack = () => {
    if (returnToHome === '1') {
      router.replace('/Homescreen');
      return;
    }
    router.back();
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.sender_id === currentUserId;
    const address = extractAddress(item.content);

    // Location / booking-confirmation bubble with a navigate launcher.
    if (address) {
      return (
        <View
          style={[
            msgStyles.bubble,
            msgStyles.locationBubble,
            isMe ? msgStyles.bubbleMe : msgStyles.bubbleThem,
          ]}
        >
          <Text style={msgStyles.bubbleText}>{item.content}</Text>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={withLightHaptic(() => openMaps(address))}
            style={msgStyles.navTouch}
          >
            <ImageBackground
              source={auraGradient}
              style={msgStyles.navCircle}
              imageStyle={{ borderRadius: NAV_SIZE / 2 }}
              resizeMode="cover"
            >
              <Ionicons name="navigate" size={NAV_SIZE * 0.5} color="#000" />
            </ImageBackground>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View
        style={[
          msgStyles.bubble,
          isMe ? msgStyles.bubbleMe : msgStyles.bubbleThem,
        ]}
      >
        <Text style={msgStyles.bubbleText}>{item.content}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header: profile pill (avatar + name) + circular back button */}
      <View style={styles.header}>
        <View style={styles.namePill}>
          <Image
            source={headerAvatar ? { uri: headerAvatar } : defaultAvatar}
            style={styles.headerAvatar}
          />
          <Text style={styles.headerName} numberOfLines={1}>
            {headerName}
          </Text>
        </View>
        <TouchableOpacity
          onPress={withLightHaptic(handleBack)}
          style={styles.backCircle}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={HEADER_BTN_HEIGHT * 0.5} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No messages yet. Say hello!</Text>
          }
        />

        {/* Composer — full-width pill with aura-gradient send button, anchored
            to the bottom of the screen (no menu bar on the conversation view). */}
        <View
          style={[
            styles.composer,
            { marginBottom: keyboardVisible ? screenWidth * 0.02 : insets.bottom + screenWidth * 0.02 },
          ]}
        >
          <TextInput
            style={styles.input}
            value={newMessage}
            onChangeText={setNewMessage}
            placeholder="Message..."
            placeholderTextColor="rgba(0,0,0,0.4)"
            multiline
            returnKeyType="send"
            onSubmitEditing={sendMessage}
          />
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={sendMessage}
            style={styles.sendTouch}
          >
            <ImageBackground
              source={auraGradient}
              style={styles.sendCircle}
              imageStyle={{ borderRadius: SEND_SIZE / 2 }}
              resizeMode="cover"
            >
              <Ionicons name="arrow-up" size={SEND_SIZE * 0.5} color="#000" />
            </ImageBackground>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#DCDBD8' },
  flex: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: screenWidth * 0.05,
    paddingTop: screenWidth * 0.02,
    paddingBottom: screenWidth * 0.03,
  },
  namePill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: HEADER_BTN_HEIGHT,
    paddingLeft: screenWidth * 0.02,
    paddingRight: screenWidth * 0.05,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    gap: screenWidth * 0.025,
    maxWidth: '75%',
  },
  headerAvatar: {
    width: HEADER_AVATAR,
    height: HEADER_AVATAR,
    borderRadius: HEADER_AVATAR / 2,
  },
  headerName: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.045,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  backCircle: {
    width: HEADER_BTN_HEIGHT,
    height: HEADER_BTN_HEIGHT,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  messageList: {
    paddingHorizontal: screenWidth * 0.04,
    paddingTop: screenWidth * 0.02,
    paddingBottom: screenWidth * 0.03,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  empty: {
    textAlign: 'center',
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.035,
    color: 'rgba(0,0,0,0.4)',
    marginTop: 40,
  },

  // Composer
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginHorizontal: screenWidth * 0.04,
    paddingLeft: screenWidth * 0.05,
    paddingRight: screenWidth * 0.015,
    paddingVertical: screenWidth * 0.015,
    backgroundColor: '#F4F4F4',
    borderRadius: 999,
    gap: screenWidth * 0.02,
  },
  input: {
    flex: 1,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.04,
    color: '#000',
    maxHeight: screenWidth * 0.28,
    paddingVertical: screenWidth * 0.025,
  },
  sendTouch: {
    borderRadius: SEND_SIZE / 2,
    overflow: 'hidden',
  },
  sendCircle: {
    width: SEND_SIZE,
    height: SEND_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const msgStyles = StyleSheet.create({
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: screenWidth * 0.04,
    paddingVertical: screenWidth * 0.028,
    marginBottom: screenWidth * 0.02,
    backgroundColor: '#F4F4F4',
  },
  bubbleMe: {
    alignSelf: 'flex-end',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 5,
  },
  bubbleThem: {
    alignSelf: 'flex-start',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 5,
  },
  locationBubble: {
    maxWidth: '90%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: screenWidth * 0.03,
  },
  bubbleText: {
    flexShrink: 1,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.04,
    color: '#000000',
  },
  navTouch: {
    borderRadius: NAV_SIZE / 2,
    overflow: 'hidden',
  },
  navCircle: {
    width: NAV_SIZE,
    height: NAV_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
