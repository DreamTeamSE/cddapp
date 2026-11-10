import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

/** Entry point for sensor-file inspection and cuff logging (not BP inference). */
export default function RecordingInspectLink() {
  return (
    <Link href={'/ml-recording' as Href} asChild>
      <Pressable accessibilityRole="button" style={styles.button}>
        <Text style={styles.title}>Inspect a sensor recording</Text>
        <Text style={styles.subtitle}>Check CSV/JSON timing and quality diagnostics (no BP inference)</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  button: { margin: 24, marginTop: 16, padding: 20, borderRadius: 14, backgroundColor: '#184b66' },
  title: { color: '#fff', fontWeight: '700', fontSize: 18 },
  subtitle: { color: '#dcebf1', fontSize: 14, marginTop: 6 },
});
