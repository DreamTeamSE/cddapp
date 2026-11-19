import { Ionicons } from '@expo/vector-icons';
import React, { forwardRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Tokens taken from the existing Figma screens: white surfaces, black type, pale blue arch, outlined pills. */
export const AuthColors = {
  text: '#000000',
  muted: '#6B7280',
  border: '#C9CED6',
  borderStrong: '#000000',
  surface: '#FFFFFF',
  tint: '#E9EEF6',
  focus: '#1F5F8B',
  error: '#B42318',
  errorBg: '#FEF3F2',
} as const;

/** Safe area → keyboard avoidance → scroll view that still accepts taps while the keyboard is open. */
export function FormScreen({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface FormFieldProps extends TextInputProps {
  readonly label: string;
  readonly hint?: string;
  readonly secureToggle?: boolean;
}

export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, hint, secureToggle, style, onFocus, onBlur, ...inputProps },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputShell, focused && styles.inputShellFocused]}>
        <TextInput
          {...inputProps}
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={AuthColors.muted}
          style={[styles.input, style]}
          secureTextEntry={secureToggle ? hidden : inputProps.secureTextEntry}
          onFocus={(event) => { setFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
        />
        {secureToggle ? (
          <Pressable
            onPress={() => setHidden((value) => !value)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
          >
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={22} color={AuthColors.muted} />
          </Pressable>
        ) : null}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
});

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle-outline" size={20} color={AuthColors.error} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

interface PillButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: 'primary' | 'secondary';
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  readonly disabled?: boolean;
}

export function PillButton({ label, onPress, variant = 'primary', loading = false, loadingLabel, disabled = false }: PillButtonProps) {
  const inactive = disabled || loading;
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.pill,
        primary ? styles.pillPrimary : styles.pillSecondary,
        inactive && styles.pillInactive,
        pressed && !inactive && styles.pillPressed,
      ]}
    >
      {loading ? <ActivityIndicator color={primary ? '#fff' : AuthColors.text} style={styles.spinner} /> : null}
      <Text style={[styles.pillText, primary ? styles.pillTextPrimary : styles.pillTextSecondary]}>
        {loading && loadingLabel ? loadingLabel : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AuthColors.surface },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 24 },
  footer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8, gap: 12, backgroundColor: AuthColors.surface },
  field: { marginBottom: 18 },
  label: { fontSize: 16, fontWeight: '600', color: AuthColors.text, marginBottom: 8 },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: AuthColors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 52,
    backgroundColor: AuthColors.surface,
  },
  inputShellFocused: { borderColor: AuthColors.focus, borderWidth: 2, paddingHorizontal: 13 },
  input: { flex: 1, fontSize: 17, color: AuthColors.text, paddingVertical: 12 },
  hint: { fontSize: 13, color: AuthColors.muted, marginTop: 6 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: AuthColors.errorBg,
    borderRadius: 10,
    padding: 12,
    marginBottom: 18,
  },
  errorText: { flex: 1, fontSize: 15, color: AuthColors.error, lineHeight: 20 },
  pill: {
    minHeight: 52,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  pillPrimary: { backgroundColor: AuthColors.text },
  pillSecondary: { backgroundColor: AuthColors.surface, borderWidth: 1, borderColor: AuthColors.borderStrong },
  pillInactive: { opacity: 0.45 },
  pillPressed: { opacity: 0.8 },
  pillText: { fontSize: 17, fontWeight: '600' },
  pillTextPrimary: { color: '#FFFFFF' },
  pillTextSecondary: { color: AuthColors.text },
  spinner: { marginRight: 10 },
});
