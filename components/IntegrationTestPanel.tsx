import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { checkAnyPpg } from '@/services/anyppg/synthetic';
import { inferWatchRecording, rejectSparkFunCsv } from '@/services/anyppg/watchInference';
import { history, recordCsvReport } from '@/services/anyppg/sessionHistory';
import { makeDemoSyncRecording } from '@/services/recordings/syncContract';
import { assessRecordingQuality } from '@/services/recordings/qualityGate';
import { createPipelineSimulator } from '@/services/device/pipeline-simulation';

type CheckResult = { name: string; passed: boolean; detail: string; ms: number };

async function timed(name: string, fn: () => Promise<string> | string): Promise<CheckResult> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { name, passed: true, detail, ms: Date.now() - started };
  } catch (error) {
    return {
      name,
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    };
  }
}

export default function IntegrationTestPanel() {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [summary, setSummary] = useState('');
  const cancel = useRef(false);

  async function runPanel() {
    if (busy) return;
    setBusy(true);
    cancel.current = false;
    setResults([]);
    setSummary('Running…');
    const out: CheckResult[] = [];

    out.push(
      await timed('App boots / JS runtime OK', () => `platform=${Platform.OS} v${Platform.Version}`),
    );

    out.push(
      await timed('Legacy SparkFun CSV rejected on watch path', () => {
        try {
          rejectSparkFunCsv({ kind: 'cdd_serial_csv_v1', format: 'legacy_ac', rows: [[0, 1, 2]] });
          throw new Error('Expected rejection');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/SparkFun|synchronized/i.test(message)) throw error;
          return message;
        }
      }),
    );

    out.push(
      await timed('High-motion sync fixture rejected by quality gate', () => {
        const recording = makeDemoSyncRecording({ seconds: 32, motion: 'high', recordingId: 'panel-high' });
        const assessment = assessRecordingQuality(recording, { motionRmsMax: 0.2 });
        if (assessment.accepted) throw new Error('High motion must not be accepted');
        return assessment.rejectionReasons.join('; ');
      }),
    );

    out.push(
      await timed('Low-motion sync fixture passes quality gate', () => {
        const recording = makeDemoSyncRecording({ seconds: 32, motion: 'low', recordingId: 'panel-low-q' });
        const assessment = assessRecordingQuality(recording);
        if (!assessment.accepted) throw new Error(assessment.rejectionReasons.join('; '));
        return `motionRms=${assessment.motionRms?.toFixed?.(4) ?? assessment.motionRms}`;
      }),
    );

    out.push(
      await timed('Scheduler/BLE foreground simulation script', () => {
        const report = createPipelineSimulator().runScriptedDemo();
        if (report.liveBleValidated || report.backgroundExecutionValidated) {
          throw new Error('Simulation must not claim live BLE/background validation');
        }
        return `events=${report.events.length} intervals=${report.intervals.length}`;
      }),
    );

    out.push(
      await timed('History idempotent estimate + missed interval', () => {
        const first = history.saveEstimate({
          recordingId: 'panel-hist',
          intervalId: 'panel-hist-interval',
          captureStartedAt: '2026-11-09T18:00:00.000Z',
          sbp: 118,
          dbp: 76,
          channel: 'red',
          preprocessingVersion: 'anyppg_watch_prep_v1',
          qualityStatus: 'accepted',
          sourceKind: 'watch_live',
        });
        const second = history.saveEstimate({
          recordingId: 'panel-hist',
          intervalId: 'panel-hist-interval',
          captureStartedAt: '2026-11-09T18:00:00.000Z',
          sbp: 1,
          dbp: 1,
          channel: 'red',
          preprocessingVersion: 'anyppg_watch_prep_v1',
          qualityStatus: 'accepted',
          sourceKind: 'watch_live',
        });
        if (first.sbp !== second.sbp) throw new Error('Duplicate mutated estimate');
        history.markMissed('panel-missed', 'panel_test');
        if (history.getInterval('panel-missed')?.state !== 'missed') throw new Error('Missed not stored');
        if (history.getInterval('panel-missed')?.estimateId) throw new Error('Missed invented estimate');
        return 'idempotent + missed OK';
      }),
    );

    // Native ONNX paths — only pass when they actually execute on device.
    out.push(
      await timed('AnyPPG synthetic reference (native ONNX)', async () => {
        const report = await checkAnyPpg(() => cancel.current, () => {});
        if (!report.complete || !report.synthetic) throw new Error('Synthetic check incomplete');
        recordCsvReport(report);
        const w = report.windows[0];
        return `windows=${report.windows.length} first=${w.sbp.toFixed(2)}/${w.dbp.toFixed(2)} (expect Python ±0.01 on device)`;
      }),
    );

    out.push(
      await timed('Watch path: high-motion does not fabricate BP', async () => {
        const report = await inferWatchRecording(
          makeDemoSyncRecording({ seconds: 32, motion: 'high', recordingId: `panel-watch-high-${Date.now()}` }),
          () => cancel.current,
        );
        if (report.status === 'accepted') throw new Error('Must not accept high motion');
        return `status=${report.status} reasons=${(report.rejectionReasons || []).join('; ') || report.error}`;
      }),
    );

    out.push(
      await timed('Watch path: low-motion synthetic reaches AnyPPG', async () => {
        const report = await inferWatchRecording(
          makeDemoSyncRecording({ seconds: 32, motion: 'low', recordingId: `panel-watch-low-${Date.now()}` }),
          () => cancel.current,
        );
        if (report.status !== 'accepted') {
          throw new Error(report.error || (report.rejectionReasons || []).join('; ') || report.status);
        }
        return `SBP/DBP=${Number(report.sbp).toFixed(2)}/${Number(report.dbp).toFixed(2)} ms=${report.processingMs}`;
      }),
    );

    setResults(out);
    const passed = out.filter((r) => r.passed).length;
    setSummary(
      `${passed}/${out.length} checks passed on ${Platform.OS}. ` +
        `Physical-iPhone claim requires this panel to be run on a real device build. ` +
        `liveBleValidated=false backgroundExecutionValidated=false newWatchHardwareValidated=false`,
    );
    setBusy(false);
  }

  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>DEV · INTEGRATION PANEL</Text>
      <Text style={s.title}>In-app pass/fail checks</Text>
      <Text style={s.body}>
        Runs software wiring checks and native AnyPPG/watch-path scenarios when ONNX is available. Do not treat host
        Node tests as physical iPhone proof.
      </Text>
      <Pressable disabled={busy} accessibilityRole="button" style={[s.button, busy && s.disabled]} onPress={runPanel}>
        <Text style={s.buttonText}>{busy ? 'Running…' : 'Run integration checks'}</Text>
      </Pressable>
      {busy && <ActivityIndicator color="#184d60" style={{ marginTop: 12 }} />}
      {!!summary && <Text style={s.summary}>{summary}</Text>}
      {results.map((item) => (
        <View key={item.name} style={s.row}>
          <Text style={item.passed ? s.pass : s.fail}>{item.passed ? 'PASS' : 'FAIL'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{item.name}</Text>
            <Text style={s.detail}>
              {item.detail} · {item.ms} ms
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { margin: 18, padding: 20, borderRadius: 22, backgroundColor: '#f0f4f8' },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.4, color: '#376371' },
  title: { fontSize: 22, fontWeight: '700', color: '#18333f', marginVertical: 8 },
  body: { fontSize: 15, lineHeight: 22, color: '#435460' },
  button: { backgroundColor: '#184d60', padding: 15, borderRadius: 13, alignItems: 'center', marginTop: 14 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.5 },
  summary: { marginTop: 12, fontSize: 13, lineHeight: 19, color: '#254754', fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'flex-start' },
  pass: { color: '#1b6b3a', fontWeight: '800', width: 44 },
  fail: { color: '#9f2222', fontWeight: '800', width: 44 },
  name: { fontSize: 14, fontWeight: '600', color: '#18333f' },
  detail: { fontSize: 12, lineHeight: 17, color: '#53616b', marginTop: 2 },
});
