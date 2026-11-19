import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthColors } from './auth-ui';

/** Echoes the Home screen's pale arch so sign-in feels like the same app. */
export function AuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.wrapper}>
      <LinearGradient colors={['#DDE8F6', '#EEF3F9', '#FFFFFF']} locations={[0, 0.6, 1]} style={styles.arch}>
        <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <MaterialCommunityIcons name="heart-pulse" size={44} color={AuthColors.text} />
        </View>
      </LinearGradient>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', marginTop: 16, marginBottom: 28 },
  arch: {
    width: '100%',
    height: 150,
    borderTopLeftRadius: 150,
    borderTopRightRadius: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: AuthColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 28, fontWeight: '700', color: AuthColors.text, marginTop: 8, textAlign: 'center' },
  subtitle: { fontSize: 16, color: AuthColors.muted, marginTop: 8, textAlign: 'center', lineHeight: 22 },
});
