import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { LivePpgBuffer } from '@/services/measurement/livePpgBuffer';
import { bleStreamService, type BleStreamState } from '@/services/device/bleStreamService';
import { predictLiveChannels } from '@/services/anyppg/liveInference';
import type { LiveChannelPrediction } from '@/services/measurement/livePpgBuffer';

interface LiveBpReading {
  red: LiveChannelPrediction;
  infrared: LiveChannelPrediction;
  timestamp: string;
}

export default function BpLiveCard() {
  const [streamState, setStreamState] = useState<BleStreamState>('disconnected');
  const [secondsBuffered, setSecondsBuffered] = useState(0);
  const [reading, setReading] = useState<LiveBpReading | null>(null);
  const [error, setError] = useState<string>('');
  const [waveform, setWaveform] = useState<number[]>([]);
  const [activeChannel, setActiveChannel] = useState<'red' | 'infrared'>('red');
  const [inferencing, setInferencing] = useState(false);

  const bufferRef = useRef(new LivePpgBuffer());
  const inferenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    // Listen to BLE Stream updates
    const unsubscribeStream = bleStreamService.subscribe({
      onStateChange(nextState) {
        if (!mounted.current) return;
        setStreamState(nextState);
        if (nextState === 'disconnected') {
          bufferRef.current.clear();
          setSecondsBuffered(0);
          setWaveform([]);
        }
      },
      onSample(sample) {
        if (!mounted.current) return;
        bufferRef.current.addSample(sample);
      },
      onError(err) {
        if (!mounted.current) return;
        setError(err);
      },
    });

    // App state listener: pause/disconnect when leaving active state
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        bleStreamService.disconnect();
      }
    });

    // UI waveform and inference loop (runs every 100ms for UI, triggers inference every ~3s)
    let lastInferenceMs = 0;
    const tickInterval = setInterval(async () => {
      if (!mounted.current) return;
      const buf = bufferRef.current;
      const durationSec = Math.floor(buf.durationSeconds);
      setSecondsBuffered(Math.min(30, durationSec));

      // Update live waveform sparkline (last 30 samples of active channel)
      const recent = buf.getRecentWaveform(30);
      const points = activeChannel === 'red' ? recent.red : recent.infrared;
      if (points.length > 0) {
        setWaveform(points);
      }

      // Check if 30s buffer is ready and 3s have elapsed since last inference
      const now = Date.now();
      if (buf.isReady(30) && now - lastInferenceMs >= 3000) {
        lastInferenceMs = now;
        const windowRed = buf.getLatestWindow('red', 30);
        const windowIr = buf.getLatestWindow('infrared', 30);

        if (windowRed && windowIr) {
          try {
            setInferencing(true);
            const result = await predictLiveChannels(windowRed, windowIr);
            if (mounted.current) {
              setReading({
                red: result.red,
                infrared: result.infrared,
                timestamp: new Date().toLocaleTimeString(),
              });
              setError('');
            }
          } catch (err: any) {
            if (mounted.current) {
              // On web/simulator without native ONNX, provide informational hint
              setError(err.message || String(err));
            }
          } finally {
            if (mounted.current) setInferencing(false);
          }
        }
      }
    }, 150);

    return () => {
      mounted.current = false;
      unsubscribeStream();
      appStateSub.remove();
      clearInterval(tickInterval);
      if (inferenceTimerRef.current) clearInterval(inferenceTimerRef.current);
      bleStreamService.disconnect();
    };
  }, [activeChannel]);

  async function handleShare() {
    if (!reading) return;
    try {
      await Share.share({
        message: `CDD Live Blood Pressure: ${reading.red.sbp.toFixed(1)} / ${reading.red.dbp.toFixed(1)} mmHg at ${reading.timestamp}`,
      });
    } catch (e: any) {
      setError(String(e));
    }
  }

  // Render SVG Sparkline
  function renderSparkline() {
    if (waveform.length < 2) return null;
    const min = Math.min(...waveform);
    const max = Math.max(...waveform);
    const range = max - min || 1;
    const width = 280;
    const height = 48;

    const points = waveform
      .map((val, idx) => {
        const x = (idx / (waveform.length - 1)) * width;
        const y = height - ((val - min) / range) * (height - 8) - 4;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    return (
      <View style={s.sparklineContainer}>
        <Text style={s.sparklineLabel}>LIVE PPG PULSE RHYTHM ({activeChannel.toUpperCase()})</Text>
        <Svg width={width} height={height} style={s.svg}>
          <Polyline points={points} fill="none" stroke="#184d60" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
    );
  }

  const isStreaming = streamState === 'connected' || streamState === 'simulating';
  const progressRatio = Math.min(1, secondsBuffered / 30);
  const currentPred = reading ? (activeChannel === 'red' ? reading.red : reading.infrared) : null;

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Text style={s.eyebrow}>REAL-TIME WEARABLE BLE</Text>
        <View style={[s.badge, isStreaming ? s.badgeActive : s.badgeInactive]}>
          <Text style={s.badgeText}>
            {streamState === 'connected'
              ? 'BLE CONNECTED'
              : streamState === 'simulating'
                ? 'SIMULATING STREAM'
                : streamState === 'scanning'
                  ? 'SCANNING...'
                  : 'DISCONNECTED'}
          </Text>
        </View>
      </View>

      <Text style={s.title}>Live Blood Pressure</Text>
      <Text style={s.body}>
        Streams continuous Red & Infrared PPG from the ESP32 wearable over BLE, buffers 30-second windows, and predicts blood pressure on-device.
      </Text>

      {/* Control Buttons */}
      {!isStreaming ? (
        <View style={s.buttonCol}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setError('');
              bleStreamService.connectBle('CDD-Wearable');
            }}
            style={s.primaryButton}
          >
            <Text style={s.primaryButtonText}>Connect to ESP32 (BLE)</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setError('');
              bleStreamService.startSimulation();
            }}
            style={s.demoButton}
          >
            <Text style={s.demoButtonText}>Test with Simulated Stream</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.buttonCol}>
          <Pressable
            accessibilityRole="button"
            onPress={() => bleStreamService.disconnect()}
            style={[s.primaryButton, s.disconnectButton]}
          >
            <Text style={s.primaryButtonText}>Disconnect Stream</Text>
          </Pressable>
        </View>
      )}

      {/* Real-time Streaming Metrics */}
      {isStreaming && (
        <View style={s.liveArea}>
          {renderSparkline()}

          {/* Buffer Progress Bar */}
          <View style={s.progressContainer}>
            <View style={s.progressLabelRow}>
              <Text style={s.progressLabel}>Window Buffer</Text>
              <Text style={s.progressValue}>{secondsBuffered} / 30s</Text>
            </View>
            <View style={s.progressBarTrack}>
              <View style={[s.progressBarFill, { width: `${progressRatio * 100}%` }]} />
            </View>
            {secondsBuffered < 30 ? (
              <Text style={s.hintText}>Accumulating initial 30-second window. Keep sensor steady.</Text>
            ) : (
              <Text style={s.activeText}>Sliding window active • refreshing every 3s {inferencing && '⚡'}</Text>
            )}
          </View>

          {/* Channel Selector */}
          <View style={s.channelRow}>
            <Pressable
              onPress={() => setActiveChannel('red')}
              style={[s.channelChip, activeChannel === 'red' && s.channelChipSelected]}
            >
              <Text style={activeChannel === 'red' ? s.channelChipTextSelected : s.channelChipText}>Red Light Channel</Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveChannel('infrared')}
              style={[s.channelChip, activeChannel === 'infrared' && s.channelChipSelected]}
            >
              <Text style={activeChannel === 'infrared' ? s.channelChipTextSelected : s.channelChipText}>Infrared Channel</Text>
            </Pressable>
          </View>

          {/* Blood Pressure Reading Card */}
          {currentPred ? (
            <View style={s.readingCard}>
              <Text style={s.readingLabel}>ESTIMATED BLOOD PRESSURE ({activeChannel.toUpperCase()})</Text>
              <Text style={s.readingNumber}>
                {currentPred.sbp.toFixed(1)} / {currentPred.dbp.toFixed(1)}{' '}
                <Text style={s.readingUnit}>mmHg</Text>
              </Text>
              <Text style={s.readingMeta}>
                Updated at {reading?.timestamp} • Computed in {currentPred.inferenceMs.toFixed(1)} ms
              </Text>
              <View style={s.actionRow}>
                <Pressable onPress={handleShare} style={s.shareLink}>
                  <Text style={s.shareText}>Share Reading</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            secondsBuffered >= 30 && (
              <View style={s.loadingContainer}>
                <ActivityIndicator color="#184d60" />
                <Text style={s.hintText}>Running on-device AnyPPG neural network...</Text>
              </View>
            )
          )}
        </View>
      )}

      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { margin: 18, padding: 20, borderRadius: 22, backgroundColor: '#f3f7f9' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, color: '#376371' },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 },
  badgeActive: { backgroundColor: '#cbebd8' },
  badgeInactive: { backgroundColor: '#e2ebf0' },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#174f32' },
  title: { fontSize: 24, fontWeight: '700', color: '#18333f', marginTop: 10, marginBottom: 6 },
  body: { fontSize: 14, lineHeight: 21, color: '#435460' },
  buttonCol: { marginTop: 16, gap: 10 },
  primaryButton: { backgroundColor: '#184d60', padding: 15, borderRadius: 13, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disconnectButton: { backgroundColor: '#a83232' },
  demoButton: { borderWidth: 1, borderColor: '#184d60', padding: 13, borderRadius: 13, alignItems: 'center' },
  demoButtonText: { color: '#184d60', fontWeight: '600', fontSize: 14 },
  liveArea: { marginTop: 18 },
  sparklineContainer: { backgroundColor: '#ffffff', borderRadius: 14, padding: 12, alignItems: 'center' },
  sparklineLabel: { fontSize: 10, fontWeight: '700', color: '#688290', letterSpacing: 1, marginBottom: 6 },
  svg: { alignSelf: 'center' },
  progressContainer: { marginTop: 14 },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  progressLabel: { fontSize: 12, fontWeight: '600', color: '#324754' },
  progressValue: { fontSize: 12, fontWeight: '700', color: '#184d60' },
  progressBarTrack: { height: 7, backgroundColor: '#dde6eb', borderRadius: 4, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#184d60', borderRadius: 4 },
  hintText: { fontSize: 12, color: '#688290', marginTop: 6 },
  activeText: { fontSize: 12, color: '#1c7447', fontWeight: '600', marginTop: 6 },
  channelRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  channelChip: { flex: 1, paddingVertical: 8, borderWidth: 1, borderColor: '#b6cad2', borderRadius: 16, alignItems: 'center' },
  channelChipSelected: { backgroundColor: '#184d60', borderColor: '#184d60' },
  channelChipText: { fontSize: 12, color: '#254754', fontWeight: '500' },
  channelChipTextSelected: { fontSize: 12, color: '#ffffff', fontWeight: '700' },
  readingCard: { backgroundColor: '#ffffff', padding: 18, borderRadius: 16, marginTop: 14 },
  readingLabel: { fontSize: 11, fontWeight: '700', color: '#376371', letterSpacing: 1.1 },
  readingNumber: { fontSize: 32, fontWeight: '700', color: '#18333f', marginTop: 6 },
  readingUnit: { fontSize: 15, fontWeight: '400', color: '#688290' },
  readingMeta: { fontSize: 12, color: '#6c7c87', marginTop: 6 },
  actionRow: { marginTop: 10, flexDirection: 'row' },
  shareLink: { paddingVertical: 6 },
  shareText: { color: '#184d60', fontWeight: '600', fontSize: 13 },
  loadingContainer: { marginTop: 14, alignItems: 'center', gap: 8 },
  error: { color: '#9f2222', fontSize: 13, lineHeight: 19, marginTop: 10 },
});
