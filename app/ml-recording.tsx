import {Link, Stack, type Href} from 'expo-router';
import {useRef, useState} from 'react';
import {ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View} from 'react-native';
import {pickRecording} from '../services/recordings/pickRecording';
import {inspectRecording, makeDemoRecording, type Inspection, type SensorRecording} from '../services/recordings/recordingCore';
import {inspectSerialCsv, type SerialInspection, type SerialRecording} from '../services/recordings/serialCsv';
import {inspectSyncRecording, type SyncInspection, type SyncRecording} from '../services/recordings/syncContract';

type Recording=SensorRecording|SerialRecording|SyncRecording;
type Report=Inspection|SerialInspection|SyncInspection;
function isSync(value:Recording):value is SyncRecording{return value.kind==='cdd_ppg_imu_recording_v1';}
function isSerial(value:Recording):value is SerialRecording{return value.kind==='cdd_serial_csv_v1';}
export default function RecordingScreen() {
  const [recording,setRecording]=useState<Recording|null>(null);
  const [report,setReport]=useState<Report|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const running=useRef(false);
  function clear(){setRecording(null);setReport(null);setError('');}
  function load(value:Recording){
    const next=isSync(value)?inspectSyncRecording(value):isSerial(value)?inspectSerialCsv(value):inspectRecording(value);
    setRecording(value);setReport(next);
  }
  async function run(action:()=>Promise<void>){
    if(running.current)return;running.current=true;setBusy(true);setError('');
    try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{running.current=false;setBusy(false);}
  }
  const syncReport=report&&'contract' in report&&report.contract==='cdd_ppg_imu_recording_v1'?report as SyncInspection:null;
  return <><Stack.Screen options={{title:'Inspect a recording',headerShown:true}}/>
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.title}>Check your sensor file</Text>
      <Text style={s.body}>Choose a legacy red/infrared CSV, a single-channel JSON recording, or a synchronized PPG+IMU JSON (`cdd_ppg_imu_recording_v1`). This screen checks the data and timing; it does not calculate blood pressure. CSV AnyPPG remains on the Blood Pressure page; synchronized watch→AnyPPG is on Watch pipeline (dev).</Text>
      <Link href={'/ml-watch-pipeline' as Href} style={s.link}>Open watch pipeline (dev)</Link>
      <Text style={s.note}>The imported waveform stays in this screen’s memory. It is not added to your health journal or saved by this feature.</Text>
      <Pressable accessibilityRole="button" disabled={busy||Platform.OS==='web'} style={s.button} onPress={()=>run(async()=>{const value=await pickRecording();if(value){clear();load(value as Recording);}})}><Text style={s.white}>Choose CSV or JSON</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} style={s.button} onPress={()=>run(async()=>{clear();load(makeDemoRecording());})}><Text style={s.white}>Load synthetic example</Text></Pressable>
      {busy&&<ActivityIndicator/>}{!!error&&<Text style={s.error}>{error}</Text>}
      {report&&<View style={s.card}>
        <Text style={s.heading}>{'source' in report && report.source==='synthetic'?'Synthetic example':syncReport?'Synchronized PPG+IMU recording':'Recorded sensor data'}</Text>
        {'sampleCount' in report&&!syncReport&&<Text style={s.body}>{report.sampleCount.toLocaleString()} samples · {report.elapsedSeconds.toFixed(3)} seconds between first and last timestamp</Text>}
        {syncReport&&<>
          <Text style={s.body}>recording {syncReport.recordingId} · interval {syncReport.intervalId}</Text>
          <Text style={s.body}>PPG {syncReport.ppgSampleRateHz} Hz ({syncReport.ppg.count} samples) · IMU accel {syncReport.accelSampleRateHz} Hz / gyro {syncReport.gyroSampleRateHz} Hz</Text>
          <Text style={s.heading}>{syncReport.schemaAccepted?'Sync contract checks passed':'Sync recording needs review'}</Text>
          <Text style={s.note}>HardwareValidated={String(syncReport.hardwareValidated)}. This is not AFE4404 field validation by itself.</Text>
        </>}
        {'observedLoggedPairsPerSecond' in report&&<>
          <Text style={s.body}>Logged pairs per second: {report.observedLoggedPairsPerSecond?.toFixed(2)??'unknown'}</Text>
          <Text style={s.body}>Time between logged rows: {report.intervalMs.min.toFixed(1)}–{report.intervalMs.max.toFixed(1)} ms; median {report.intervalMs.median.toFixed(1)} ms</Text>
          <Text style={s.note}>The logging rate does not establish the sensor’s true sampling rate.</Text>
        </>}
        {'previewAllowed' in report&&!syncReport&&<Text style={s.heading}>{report.previewAllowed?'Timing/transport checks passed':'Recording needs review'}</Text>}
        {'blockers' in report&&report.blockers.map((v,i)=><Text key={'b'+i} style={s.error}>• {v}</Text>)}
        {'warnings' in report&&report.warnings.map((v,i)=><Text key={'w'+i} style={s.body}>• {v}</Text>)}
        {recording&&!isSync(recording)&&recording.kind==='cdd_ppg_recording_v1'&&<Text style={s.note}>Legacy single-channel JSON inspect only. Synchronized PPG+IMU uses cdd_ppg_imu_recording_v1.</Text>}
        <Pressable accessibilityRole="button" disabled={busy} style={s.button} onPress={()=>run(async()=>{await Share.share({message:JSON.stringify({inspection:report},null,2)});})}><Text style={s.white}>Share diagnostics only</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={s.button} onPress={clear}><Text style={s.white}>Clear imported data</Text></Pressable>
      </View>}
      <Link href={'/ml-calibration-log' as Href} style={s.link}>Record a cuff reading</Link>
    </ScrollView></>;
}
const s=StyleSheet.create({page:{padding:20,paddingBottom:48,backgroundColor:'#f6f8fa',flexGrow:1},title:{fontSize:26,fontWeight:'700',color:'#172b3a'},heading:{fontSize:19,fontWeight:'600',marginTop:18,color:'#172b3a'},body:{fontSize:16,lineHeight:24,marginTop:10,color:'#435466'},note:{fontSize:14,lineHeight:21,marginTop:12,color:'#705300'},button:{backgroundColor:'#184b66',borderRadius:12,padding:16,marginTop:16,alignItems:'center'},white:{fontSize:16,fontWeight:'600',color:'#fff'},error:{color:'#a31c1c',lineHeight:23,marginTop:12},card:{backgroundColor:'#fff',borderRadius:12,padding:16,marginTop:20},link:{color:'#184b66',fontSize:17,marginTop:24}});
