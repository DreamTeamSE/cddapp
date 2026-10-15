import { Link } from 'expo-router';
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthHeader } from '@/components/auth/auth-header';
import { AuthColors, ErrorBanner, FormField, FormScreen, PillButton } from '@/components/auth/auth-ui';
import { useAuth } from '@/context/auth-context';
import { isValidEmail, toFriendlyAuthMessage } from '@/services/auth/auth-service';

export default function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setError(null);
    setSubmitting(true);
    try {
      await signIn({ email, password });
      // The root layout's protected routes move the user on; nothing to navigate here.
    } catch (err) {
      setError(toFriendlyAuthMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <FormScreen>
      <AuthHeader title="Welcome back" subtitle="Sign in to see your blood pressure readings." />
      <ErrorBanner message={error} />
      <FormField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <FormField
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureToggle
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
      />
      <View style={styles.actions}>
        <PillButton label="Sign in" loadingLabel="Signing in…" loading={submitting} onPress={handleSubmit} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchText}>New here? </Text>
        <Link href="/sign-up" replace style={styles.switchLink} accessibilityRole="link">
          Create an account
        </Link>
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: 8 },
  switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24, flexWrap: 'wrap' },
  switchText: { fontSize: 16, color: AuthColors.muted },
  switchLink: { fontSize: 16, fontWeight: '600', color: AuthColors.text, textDecorationLine: 'underline', paddingVertical: 8 },
});
