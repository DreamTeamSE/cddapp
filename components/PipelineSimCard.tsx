import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createPipelineSimulator } from '@/services/device/pipeline-simulation';

/**
 * Foreground-only scheduler + BLE transfer demo with injectable clock.
 * Does not validate iOS background execution, live BLE, or watch firmware scheduling.
 */
export default function PipelineSimCard() {
  const sim = useMemo(() => createPipelineSimulator(), []);
  const [log, setLog] = useState<string>('Idle. Clock starts at a fixed demo epoch; advances without waiting 15 minutes.');
  const [last, setLast] = useState<Record<string, unknown> | null>(null);

  function apply(label: string, fn: () => Record<string, unknown> | { events: unknown[] }) {
    const result = fn();
    setLast(result as Record<string, unknown>);
    setLog(
      `${label}\n${JSON.stringify(result, null, 2)}\n\nIntervals: ${sim.scheduler.listIntervals().length}\nNowMs: ${sim.clock.nowMs()}`,
    );
  }

  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>DEV · SCHEDULER / BLE SIMULATION</Text>
      <Text style={s.title}>15-minute interval simulation</Text>
      <Text style={s.body}>
        Injectable clock advances instantly. Confirms foreground React Native wiring only — not background iOS,
        live BLE, or watch-side scheduling.
      </Text>
      <View style={s.notice}>
        <Text style={s.noticeTitle}>Not validated on this screen</Text>
        <Text style={s.note}>iOS background execution · live BLE · watch firmware scheduler</Text>
      </View>

      <Pressable accessibilityRole="button" style={s.button} onPress={() => apply('Successful capture', () => sim.simulateSuccessfulCapture())}>
        <Text style={s.buttonText}>Simulate successful capture</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={s.secondary} onPress={() => apply('Excessive motion', () => sim.simulateExcessiveMotion())}>
        <Text style={s.link}>Excessive motion → missed</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={s.secondary} onPress={() => apply('Missed window', () => sim.simulateMissedWindow())}>
        <Text style={s.link}>Missed measurement window</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={s.secondary}
        onPress={() => apply('BLE interrupt + retry + duplicate', () => sim.simulateInterruptedBleThenRetry())}
      >
        <Text style={s.link}>Interrupted BLE → retry + duplicate packets</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={s.secondary} onPress={() => apply('Advance 15 min', () => sim.advanceOnePeriod())}>
        <Text style={s.link}>Advance clock one 15-minute period</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={s.secondary} onPress={() => apply('App restart restore', () => sim.simulateAppRestart())}>
        <Text style={s.link}>App restart → restore interval state</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={s.secondary} onPress={() => apply('Full scripted demo', () => sim.runScriptedDemo())}>
        <Text style={s.link}>Run full scripted demo</Text>
      </Pressable>

      <Text style={s.mono}>{log}</Text>
      {last && 'liveBleValidated' in last && (
        <Text style={s.note}>
          Flags: liveBleValidated={String(last.liveBleValidated)} backgroundExecutionValidated=
          {String(last.backgroundExecutionValidated)}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { margin: 18, padding: 20, borderRadius: 22, backgroundColor: '#f4f1ea' },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.4, color: '#5a4a32' },
  title: { fontSize: 22, fontWeight: '700', color: '#2a2418', marginVertical: 8 },
  body: { fontSize: 15, lineHeight: 22, color: '#4a4338' },
  notice: { backgroundColor: '#ffe8d6', borderRadius: 12, padding: 12, marginVertical: 14 },
  noticeTitle: { color: '#7a3f12', fontWeight: '700', fontSize: 14 },
  note: { fontSize: 13, lineHeight: 19, color: '#5c5346', marginTop: 5 },
  button: { backgroundColor: '#5c4a32', padding: 15, borderRadius: 13, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondary: { paddingVertical: 11, alignItems: 'center' },
  link: { color: '#5c4a32', fontWeight: '600', fontSize: 14 },
  mono: { fontFamily: 'Menlo', fontSize: 10, lineHeight: 15, color: '#2a2418', marginTop: 12 },
});
