import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { pickRecording } from '@/services/recordings/pickRecording';
import { makeDemoSyncRecording, type SyncRecording } from '@/services/recordings/syncContract';
import { history } from '@/services/anyppg/sessionHistory';
import { inferWatchRecording, type WatchInferenceReport } from '@/services/anyppg/watchInference';

function formatDebug(report: WatchInferenceReport) {
  return [
    `status: ${report.status}`,
    `quality: ${report.qualityDecision}`,
    `recordingId: ${report.recordingId}`,
    `intervalId: ${report.intervalId}`,
    `ppgRate: ${report.ppgSampleRateHz} Hz`,
    `model: ${report.modelId}`,
    `prep: ${report.preprocessingVersion}`,
    `processingMs: ${report.processingMs}`,
    report.sbp != null ? `SBP/DBP: ${Number(report.sbp).toFixed(2)} / ${Number(report.dbp).toFixed(2)} mmHg` : null,
    report.rejectionReasons?.length ? `reasons: ${report.rejectionReasons.join('; ')}` : null,
    report.error ? `error: ${report.error}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export default function WatchPipelineCard() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [report, setReport] = useState<WatchInferenceReport | null>(null);
  const [error, setError] = useState('');
  const [historyTick, setHistoryTick] = useState(0);
  const running = useRef(false);
  const cancel = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') cancel.current = true;
    });
    return () => {
      mounted.current = false;
      cancel.current = true;
      subscription.remove();
    };
  }, []);

  async function run(recording: SyncRecording, label: string) {
    if (running.current) return;
    running.current = true;
    cancel.current = false;
    setBusy(true);
    setReport(null);
    setError('');
    setProgress(label);
    try {
      const result = await inferWatchRecording(recording, () => cancel.current);
      if (mounted.current && !cancel.current) {
        setReport(result);
        setHistoryTick((n) => n + 1);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
      if (mounted.current) {
        setBusy(false);
        setProgress('');
      }
    }
  }

  async function importSyncJson() {
    if (running.current) return;
    setError('');
    setProgress('Choose a synchronized PPG+IMU JSON…');
    setBusy(true);
    try {
      const picked = await pickRecording();
      if (!picked) return;
      if (!mounted.current) return;
      cancel.current = false;
      if (!('kind' in picked) || picked.kind !== 'cdd_ppg_imu_recording_v1') {
        throw new Error(
          'This path only accepts cdd_ppg_imu_recording_v1 JSON. Legacy SparkFun CSV belongs on the CSV AnyPPG card.',
        );
      }
      await run(picked, 'Running motion selection → quality gate → AnyPPG…');
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!running.current && mounted.current) {
        setBusy(false);
        setProgress('');
      }
    }
  }

  const intervals = history.listIntervals().slice(-8).reverse();
  const estimates = history.listEstimates().slice(-8).reverse();

  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>DEV · WATCH RECORDING PATH</Text>
      <Text style={s.title}>Synchronized PPG + IMU → AnyPPG</Text>
      <Text style={s.body}>
        Development-only path for `cdd_ppg_imu_recording_v1`. Runs motion selection, PPG quality gating,
        resampling/normalization, and native AnyPPG. Quality rejection is never bypassed.
      </Text>
      <View style={s.notice}>
        <Text style={s.noticeTitle}>Experimental prototype estimates</Text>
        <Text style={s.note}>
          Synthetic fixtures are not AFE4404/BMI270 hardware validation. SparkFun CSV is rejected here on purpose.
        </Text>
      </View>

      <Pressable
        disabled={busy}
        accessibilityRole="button"
        onPress={() =>
          run(
            makeDemoSyncRecording({ seconds: 32, motion: 'low', recordingId: `dev-low-${Date.now()}` }),
            'Low-motion synthetic fixture…',
          )
        }
        style={[s.button, busy && s.disabled]}
      >
        <Text style={s.buttonText}>Run low-motion synthetic (32 s)</Text>
      </Pressable>
      <Pressable
        disabled={busy}
        accessibilityRole="button"
        onPress={() =>
          run(
            makeDemoSyncRecording({ seconds: 32, motion: 'high', recordingId: `dev-high-${Date.now()}` }),
            'High-motion synthetic fixture…',
          )
        }
        style={s.secondary}
      >
        <Text style={s.link}>Expect reject: high-motion synthetic</Text>
      </Pressable>
      <Pressable disabled={busy} accessibilityRole="button" onPress={importSyncJson} style={s.secondary}>
        <Text style={s.link}>Import sync JSON fixture</Text>
      </Pressable>

      {busy && (
        <View accessibilityLiveRegion="polite">
          <ActivityIndicator color="#184d60" />
          <Text style={s.note}>{progress}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              cancel.current = true;
              setProgress('Stopping after current step…');
            }}
            style={s.secondary}
          >
            <Text style={s.link}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}

      {report && (
        <View accessibilityLiveRegion="polite" style={s.result}>
          <Text style={s.resultTitle}>
            {report.status === 'accepted' ? 'Accepted (experimental)' : report.status === 'rejected' ? 'Rejected / blocked' : 'Error'}
          </Text>
          <Text style={s.mono}>{formatDebug(report)}</Text>
          {report.status === 'accepted' && (
            <Text style={s.number}>
              {Number(report.sbp).toFixed(1)} / {Number(report.dbp).toFixed(1)} <Text style={s.unit}>mmHg</Text>
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={async () => {
              try {
                await Share.share({ message: JSON.stringify(report, null, 2) });
              } catch (e) {
                setError(String(e));
              }
            }}
            style={s.secondary}
          >
            <Text style={s.link}>Share debug report</Text>
          </Pressable>
        </View>
      )}

      <Text style={s.label} key={historyTick}>
        Prototype session history (in-memory)
      </Text>
      {intervals.length === 0 && <Text style={s.note}>No interval statuses yet.</Text>}
      {intervals.map((item) => (
        <Text key={item.intervalId} style={s.note}>
          {item.intervalId}: {item.state}
          {item.reason ? ` — ${item.reason}` : ''}
          {item.estimateId ? ` · estimate ${item.estimateId}` : ''}
        </Text>
      ))}
      {estimates.map((item) => (
        <Text key={item.id} style={s.note}>
          {item.id}: {item.sbp.toFixed(1)}/{item.dbp.toFixed(1)} ({item.sourceKind})
        </Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { margin: 18, padding: 20, borderRadius: 22, backgroundColor: '#eef5f7' },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.4, color: '#376371' },
  title: { fontSize: 22, fontWeight: '700', color: '#18333f', marginVertical: 8 },
  body: { fontSize: 15, lineHeight: 22, color: '#435460' },
  notice: { backgroundColor: '#fff2c8', borderRadius: 12, padding: 12, marginVertical: 14 },
  noticeTitle: { color: '#674e15', fontWeight: '700', fontSize: 14 },
  note: { fontSize: 13, lineHeight: 19, color: '#53616b', marginTop: 5 },
  label: { fontSize: 14, fontWeight: '600', color: '#254754', marginTop: 16 },
  button: { backgroundColor: '#184d60', padding: 15, borderRadius: 13, alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.5 },
  secondary: { paddingVertical: 12, alignItems: 'center' },
  link: { color: '#184d60', fontWeight: '600', fontSize: 14 },
  error: { color: '#9f2222', fontSize: 14, lineHeight: 20, marginVertical: 10 },
  result: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 12 },
  resultTitle: { fontSize: 18, fontWeight: '700', color: '#18333f' },
  mono: { fontFamily: 'Menlo', fontSize: 11, lineHeight: 16, color: '#2a3a44', marginTop: 8 },
  number: { fontSize: 28, fontWeight: '700', color: '#18333f', marginTop: 8 },
  unit: { fontSize: 13, fontWeight: '400' },
});
