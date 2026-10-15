import { Link } from 'expo-router';
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthHeader } from '@/components/auth/auth-header';
import { AuthColors, ErrorBanner, FormField, FormScreen, PillButton } from '@/components/auth/auth-ui';
import { useAuth } from '@/context/auth-context';
import { isStrongEnoughPassword, isValidEmail, MIN_PASSWORD_LENGTH, toFriendlyAuthMessage } from '@/services/auth/auth-service';

function validate(email: string, password: string, confirm: string): string | null {
  if (!isValidEmail(email)) return 'Enter a valid email address.';
  if (!isStrongEnoughPassword(password)) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters and include a letter and a number.`;
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const handleSubmit = async () => {
    if (submitting) return;
    const problem = validate(email, password, confirm);
    if (problem) return setError(problem);
    setError(null);
    setSubmitting(true);
    try {
      await signUp({ email, password });
    } catch (err) {
      setError(toFriendlyAuthMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <FormScreen>
      <AuthHeader title="Create your account" subtitle="Next, we'll ask a few health details to personalize your readings." />
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
        hint={`At least ${MIN_PASSWORD_LENGTH} characters, with a letter and a number.`}
        value={password}
        onChangeText={setPassword}
        secureToggle
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        passwordRules={`minlength: ${MIN_PASSWORD_LENGTH}; required: lower; required: digit;`}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => confirmRef.current?.focus()}
      />
      <FormField
        ref={confirmRef}
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        secureToggle
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
      />
      <View style={styles.actions}>
        <PillButton label="Create account" loadingLabel="Creating account…" loading={submitting} onPress={handleSubmit} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchText}>Already have an account? </Text>
        <Link href="/sign-in" replace style={styles.switchLink} accessibilityRole="link">
          Sign in
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
