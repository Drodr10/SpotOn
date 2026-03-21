/**
 * Auth - Reusable auth component. Made to prevent clutter on Intro screen.
 */

// ─── React & React Native ──────────────────────────────────────────────────────────────
import { useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
} from 'react-native';

// ─── Navigation ──────────────────────────────────────────────────────────────
import { router } from 'expo-router';
import enterArrowAsset  from '@/assets/images/enter arrow.png';

import { supabase } from '../utils/supabase';

type AuthStyles = {
  loginGroup: object,
  input: object,
  passwordRow: object,
  arrowButton: object,
  arrowIcon: object,
  toggleButton: object,
  buttonText: object,
  authError: object,
}

type AuthProps = {
  styles: AuthStyles,
  isNewUser: boolean,
  handleTypeChange: Function,
}

export default function Auth ( { styles, isNewUser, handleTypeChange }: AuthProps ) {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [fullName, setFullName] = useState<string>('');

  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleLogin = async () => {
    if (email === '' || password === '') {
      setErrorMessage('Please fill in all fields.');
      return;
    }

    console.log("Attempting to log in to email: " + email);

    const { error } = await supabase.auth.signInWithPassword({ email, password, });

    if (error) {
      console.log("Login failed...\n" + error.message);
      handleError(error.message);
      return;
    }
    console.log("Login successful!");

    router.replace('/Homescreen');
  };

  const handleSignup = async () => { 
    if (email === '' || password === '' || fullName === '') {
      setErrorMessage('Please fill in all fields.');
      return;
    }

    console.log("Attempting to sign up with email: "+ email);
    const { data, error } = await supabase.auth.signUp({ 
      email,
      password, 
      options: {
        data: {
          full_name: fullName,
        }
      }});

    if (error) {
      console.log("Signup failed...\n" + error.message);
      handleError(error.message);
      return;
    }
    console.log("Signup successful!");

    router.replace('/Homescreen');
  };

  //Sets displayed error message based on Supabase error message.
  const handleError = (eMessage: string) => {
    if (eMessage === "User already registered") {
      setErrorMessage("Email already in use.");
    } else if (eMessage === "Password should be at least 6 characters.") {
      setErrorMessage("Password must be at least 6 characters.")
    } else {
      setErrorMessage(eMessage);
    }
  }

  // Rendering if user is logging in.
  if (!isNewUser) {
    return (
      <View style={styles.loginGroup}>

        {/* Button that toggles signup/login form */}
        <TouchableOpacity
          style={styles.toggleButton}
          onPress={() => {
            handleTypeChange(true);
            setErrorMessage('');
          }}
        >
          <Text style={styles.buttonText}>New user? Sign up.</Text>
        </TouchableOpacity>

        {/* Username Login In — Figma: "Username Login In" */}
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor="rgba(0,0,0,0.4)"
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* Password Login In — Figma: "Password Login In" */}
        {/*
          Wrapped in a View so the enter arrow can be positioned
          absolutely over the right edge of the input field.
        */}
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="rgba(0,0,0,0.4)"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            // Submit on keyboard "done" key as well
            onSubmitEditing={handleLogin}
            returnKeyType="go"
          />

          {/* enter arrow — Figma: "enter arrow" */}
          {/* Overlaps the right edge of the password field */}
          <TouchableOpacity
            style={styles.arrowButton}
            onPress={handleLogin}
            activeOpacity={0.7}
          >
            <Image
              source={enterArrowAsset}
              style={styles.arrowIcon}
              resizeMode="contain"
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  //Rendering if user is signing up for the first time
  } else {
    return (
      <View style={styles.loginGroup}>

        <TouchableOpacity
          style={styles.toggleButton}
          onPress={() => {
            handleTypeChange(false);
            setErrorMessage('');
          }}
        >
          <Text style={styles.buttonText}>Returning user? Log in.</Text>
        </TouchableOpacity>

          {/* Full Name Signup - No figma component for this, added based on need */}
        <TextInput 
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="Full Name"
          placeholderTextColor="rgba(0,0,0,0.4)"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor="rgba(0,0,0,0.4)"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.passwordRow}>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="rgba(0,0,0,0.4)"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleSignup}
            returnKeyType="go"
          />

          <TouchableOpacity
            style={styles.arrowButton}
            onPress={handleSignup}
            activeOpacity={0.7}
          >
            <Image
              source={enterArrowAsset}
              style={styles.arrowIcon}
              resizeMode="contain"
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.authError}>{errorMessage}</Text>
      </View>
    );
  }
}