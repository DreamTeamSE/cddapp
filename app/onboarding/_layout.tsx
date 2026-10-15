import { Stack } from 'expo-router';
import React from 'react';

export default function OnboardingLayout() {
  // No swipe-back: the only ways out of onboarding are finishing it or signing out.
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: false, contentStyle: { backgroundColor: '#fff' } }} />;
}
