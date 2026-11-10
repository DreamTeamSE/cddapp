import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

/** Dev entry for synchronized PPG+IMU → AnyPPG + scheduler simulation. */
export default function WatchPipelineLink() {
  return (
    <Link href={'/ml-watch-pipeline' as Href} asChild>
      <Pressable accessibilityRole="button" style={styles.button}>
        <Text style={styles.title}>Watch pipeline (dev)</Text>
        <Text style={styles.subtitle}>
          Sync PPG+IMU fixtures · quality gate · AnyPPG · scheduler/BLE sim · integration panel
        </Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  button: { margin: 24, marginTop: 8, padding: 20, borderRadius: 14, backgroundColor: '#2f5d4a' },
  title: { color: '#fff', fontWeight: '700', fontSize: 18 },
  subtitle: { color: '#d7ebe1', fontSize: 14, marginTop: 6 },
});
