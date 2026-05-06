

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../utils/supabase';
import { CustomFonts } from '@/src/constants/theme';

const { width: screenWidth } = Dimensions.get('window');

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  sent_at: string;
}

export default function ChatScreen() {
  const router = useRouter();
  const { conversationId, otherUserName } = useLocalSearchParams<{
    conversationId: string;
    otherUserName: string;
  }>();

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    supabase.auth.getClaims().then(({ data }) => {
      if (data) setCurrentUserId(data.claims.sub);
    });
  }, []);

  useEffect(() => {
    if (!conversationId) return;

    // Load existing messages
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true })
      .then(({ data }) => {
        if (data) setMessages(data);
      });

    // Subscribe to new messages in real-time
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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !currentUserId || !conversationId) return;
    const content = newMessage.trim();
    setNewMessage('');

    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: currentUserId,
      content,
    });

    // Update last_message preview on the conversation
    await supabase
      .from('conversations')
      .update({ last_message: content, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.sender_id === currentUserId;
    return (
      <View style={[msgStyles.bubble, isMe ? msgStyles.bubbleMe : msgStyles.bubbleThem]}>
        <Text style={[msgStyles.bubbleText, isMe ? msgStyles.textMe : msgStyles.textThem]}>
          {item.content}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={screenWidth * 0.06} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {otherUserName ?? 'Chat'}
        </Text>
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
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <Text style={styles.empty}>No messages yet. Say hello!</Text>
          }
        />

        {/* Input row */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={newMessage}
            onChangeText={setNewMessage}
            placeholder="Type a message..."
            placeholderTextColor="rgba(0,0,0,0.4)"
            multiline
            returnKeyType="send"
            onSubmitEditing={sendMessage}
          />
          <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
            <Ionicons name="send" size={screenWidth * 0.05} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#DCDBD8' },
  flex: { flex: 1 },
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
    fontSize: screenWidth * 0.045,
    color: '#000',
    flex: 1,
  },
  messageList: {
    paddingHorizontal: screenWidth * 0.04,
    paddingVertical: screenWidth * 0.03,
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: screenWidth * 0.04,
    paddingVertical: screenWidth * 0.025,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
    gap: screenWidth * 0.025,
    backgroundColor: 'rgba(220,219,216,0.95)',
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: screenWidth * 0.04,
    paddingVertical: screenWidth * 0.025,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.038,
    color: '#000',
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: '#007AFF',
    borderRadius: 999,
    padding: screenWidth * 0.03,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const msgStyles = StyleSheet.create({
  bubble: {
    maxWidth: '75%',
    borderRadius: 16,
    paddingHorizontal: screenWidth * 0.04,
    paddingVertical: screenWidth * 0.025,
    marginBottom: screenWidth * 0.02,
  },
  bubbleMe: {
    backgroundColor: '#007AFF',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: 'rgba(0,0,0,0.1)',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: screenWidth * 0.038 },
  textMe: { color: '#fff', fontFamily: CustomFonts.SwitzerLight },
  textThem: { color: '#000', fontFamily: CustomFonts.SwitzerLight },
});
