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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Alert,
  Pressable,
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
import {
  type BlockStatus,
  blockUser,
  getBlockStatus,
  isMessagingBlockedError,
  unblockUser,
} from '@/src/utils/moderation';
import ReportSheet from '@/src/components/ReportSheet';
import ChatActionsMenu, {
  MENU_OVERHANG,
  type ChatMenuItem,
} from '@/src/components/moderation/ChatActionsMenu';
import {
  triggerDestructiveHaptic,
  triggerErrorHaptic,
} from '@/src/components/moderation/haptics';

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
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [blockStatus, setBlockStatus] = useState<BlockStatus>('none');
  const [menuOpen, setMenuOpen] = useState(false);
  const [pillSize, setPillSize] = useState({ width: 0, height: 0 });
  const [reportVisible, setReportVisible] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
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
      setOtherUserId(otherId);
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

  // Who has blocked whom (either direction). The database trigger is the real
  // enforcement; this only decides whether to show the composer.
  const refreshBlockStatus = useCallback(
    async (fallback: BlockStatus = 'none') => {
      if (!otherUserId) return;
      const status = await getBlockStatus(otherUserId);
      setBlockStatus(status === 'none' ? fallback : status);
    },
    [otherUserId],
  );

  useEffect(() => {
    if (!otherUserId) return;
    let cancelled = false;
    getBlockStatus(otherUserId).then((status) => {
      if (!cancelled) setBlockStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [otherUserId]);

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
          const incoming = payload.new as Message;
          // Our own messages are already on screen optimistically and their
          // echo arrives here too, so dedupe by id rather than appending
          // blindly — otherwise every message we send renders twice.
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
          );
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

    // Show it immediately under a temporary id instead of waiting for the round
    // trip. Sending used to leave the thread visibly unchanged, which reads as
    // "it didn't go through" and gets the same message sent twice.
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        conversation_id: conversationId,
        sender_id: currentUserId,
        content,
        sent_at: new Date().toISOString(),
      },
    ]);

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: currentUserId,
        content,
      })
      .select()
      .single();

    // The insert result was previously discarded, so a failed send just
    // disappeared. Take the optimistic row back out and give the user their
    // text back so it isn't lost.
    if (error || !data) {
      console.warn('[Chat] send failed', error);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      // The database refuses messages between blocked users. Show the calm
      // banner instead of an error, and don't hand the text back - there is no
      // composer to put it in.
      if (isMessagingBlockedError(error)) {
        triggerErrorHaptic();
        refreshBlockStatus('blocked_by_them');
        return;
      }
      setNewMessage((cur) => (cur.length > 0 ? cur : content));
      return;
    }

    // Swap the temporary row for the server one so its id is real. Also drop
    // any copy the realtime subscription delivered in the meantime — whichever
    // of the two arrives second must not add a duplicate.
    setMessages((prev) => [
      ...prev.filter((m) => m.id !== tempId && m.id !== data.id),
      data as Message,
    ]);

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

  // -- Report / block -------------------------------------------------------
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const openMenu = () => {
    if (!otherUserId) return;
    triggerLightHaptic();
    setMenuOpen((open) => !open);
  };

  const handleReport = () => {
    if (!otherUserId) return;
    triggerLightHaptic();
    setMenuOpen(false);
    setReportVisible(true);
  };

  const handleBlock = () => {
    if (!otherUserId) return;
    triggerLightHaptic();
    setMenuOpen(false);
    Alert.alert(
      `Block ${headerName}?`,
      `You and ${headerName} won't be able to message each other, and this conversation will be hidden from your inbox. You can unblock them anytime.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            triggerDestructiveHaptic();
            setBlockBusy(true);
            try {
              await blockUser(otherUserId);
              setBlockStatus('blocked_by_me');
            } catch (e) {
              triggerErrorHaptic();
              Alert.alert(
                "Couldn't block",
                e instanceof Error ? e.message : 'Please try again.',
              );
            } finally {
              setBlockBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleUnblock = async () => {
    if (!otherUserId || blockBusy) return;
    triggerLightHaptic();
    setMenuOpen(false);
    setBlockBusy(true);
    try {
      await unblockUser(otherUserId);
      await refreshBlockStatus();
    } catch (e) {
      triggerErrorHaptic();
      Alert.alert("Couldn't unblock", e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBlockBusy(false);
    }
  };

  const menuItems: ChatMenuItem[] = [
    { key: 'report', label: 'Report user', icon: 'flag-outline', onPress: handleReport },
    blockStatus === 'blocked_by_me'
      ? { key: 'unblock', label: 'Unblock user', icon: 'checkmark-circle-outline', onPress: handleUnblock }
      : { key: 'block', label: 'Block user', icon: 'ban-outline', destructive: true, onPress: handleBlock },
  ];

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
      {menuOpen && (
        <Pressable
          style={styles.menuBackdrop}
          onPress={closeMenu}
          accessibilityLabel="Close menu"
          accessibilityRole="button"
        />
      )}
      <View style={styles.header} pointerEvents="box-none">
        <View style={styles.pillWrap} pointerEvents="box-none">
          {/* Rendered before the pill so the pill paints over the panel's top edge. */}
          <ChatActionsMenu
            open={menuOpen}
            pillWidth={pillSize.width}
            pillHeight={pillSize.height}
            items={menuItems}
            minWidth={screenWidth * 0.56}
          />
          <Pressable
            onPress={openMenu}
            onLayout={(e) =>
              setPillSize({
                width: e.nativeEvent.layout.width,
                height: e.nativeEvent.layout.height,
              })
            }
            style={({ pressed }) => [styles.namePill, pressed && styles.namePillPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${headerName}. Conversation options`}
            accessibilityState={{ expanded: menuOpen }}
          >
            <Image
              source={headerAvatar ? { uri: headerAvatar } : defaultAvatar}
              style={styles.headerAvatar}
            />
            <Text style={styles.headerName} numberOfLines={1}>
              {headerName}
            </Text>
            <Ionicons
              name={menuOpen ? 'chevron-up' : 'chevron-down'}
              size={screenWidth * 0.04}
              color="rgba(255,255,255,0.7)"
            />
          </Pressable>
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
        {blockStatus !== 'none' ? (
          <View
            style={[
              styles.blockedBanner,
              { marginBottom: insets.bottom + screenWidth * 0.02 },
            ]}
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.blockedText}>
              {blockStatus === 'blocked_by_me'
                ? `You blocked ${headerName}. Unblock to message.`
                : "You can't reply to this conversation."}
            </Text>
            {blockStatus === 'blocked_by_me' && (
              <Pressable
                onPress={handleUnblock}
                disabled={blockBusy}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${headerName}`}
                style={({ pressed }) => [
                  styles.unblockBtn,
                  (pressed || blockBusy) && styles.namePillPressed,
                ]}
              >
                <Text style={styles.unblockText}>Unblock</Text>
              </Pressable>
            )}
          </View>
        ) : (
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
        )}
      </KeyboardAvoidingView>

      <ReportSheet
        visible={reportVisible}
        target={
          reportVisible && otherUserId
            ? {
                kind: 'user',
                userId: otherUserId,
                userName: headerName,
                conversationId,
              }
            : null
        }
        onClose={() => {
          setReportVisible(false);
          // The sheet can block the user too ("Also block ..."); pick that up.
          refreshBlockStatus();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#DCDBD8' },
  flex: { flex: 1 },

  // Dropdown plumbing: the header sits above the tap-away backdrop.
  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
  // Android only hit-tests inside a parent's bounds, so the wrapper and header grow by
  // the panel's overhang and take it back with a negative margin (layout unchanged).
  pillWrap: {
    maxWidth: '75%',
    position: 'relative',
    paddingBottom: MENU_OVERHANG,
    marginBottom: -MENU_OVERHANG,
  },
  namePillPressed: { opacity: 0.8 },

  // Header
  header: {
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: screenWidth * 0.05,
    paddingTop: screenWidth * 0.02,
    paddingBottom: screenWidth * 0.03 + MENU_OVERHANG,
    marginBottom: -MENU_OVERHANG,
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
    minWidth: screenWidth * 0.4,
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
  // Shown instead of the composer when either side has blocked the other.
  blockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: screenWidth * 0.04,
    paddingLeft: screenWidth * 0.05,
    paddingRight: screenWidth * 0.02,
    paddingVertical: screenWidth * 0.025,
    minHeight: screenWidth * 0.15,
    backgroundColor: '#F4F4F4',
    borderRadius: 999,
    gap: screenWidth * 0.025,
  },
  blockedText: {
    flex: 1,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.038,
    color: 'rgba(0,0,0,0.65)',
  },
  unblockBtn: {
    height: screenWidth * 0.11,
    paddingHorizontal: screenWidth * 0.045,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unblockText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.038,
    color: '#FFFFFF',
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
