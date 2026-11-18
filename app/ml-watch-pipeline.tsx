import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import WatchPipelineCard from '@/components/WatchPipelineCard';
import PipelineSimCard from '@/components/PipelineSimCard';
import IntegrationTestPanel from '@/components/IntegrationTestPanel';

/**
 * Development wiring for synchronized watch recordings, scheduler/BLE simulation,
 * and in-app integration checks. Not a clinical BP product screen.
 */
export default function WatchPipelineScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Watch pipeline (dev)', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.title}>Watch recording integration</Text>
        <Text style={styles.body}>
          Separate from the legacy SparkFun CSV AnyPPG demo. Use this screen to exercise motion selection, quality
          gating, native ONNX inference, prototype history, and foreground scheduler/BLE simulation.
        </Text>
        {!__DEV__ ? (
          <View style={styles.prodNotice}>
            <Text style={styles.prodTitle}>Development tools</Text>
            <Text style={styles.body}>
              This panel is intended for development and internal verification builds. Production Release demos should
              still keep estimates clearly labeled experimental.
            </Text>
          </View>
        ) : null}
        <WatchPipelineCard />
        <PipelineSimCard />
        <IntegrationTestPanel />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: 48, backgroundColor: '#f6f8fa', flexGrow: 1 },
  title: { fontSize: 26, fontWeight: '700', color: '#172b3a', marginHorizontal: 18, marginTop: 16 },
  body: { fontSize: 15, lineHeight: 22, color: '#435466', marginHorizontal: 18, marginTop: 8 },
  prodNotice: {
    marginHorizontal: 18,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff2c8',
  },
  prodTitle: { fontWeight: '700', color: '#674e15', marginBottom: 4 },
});
