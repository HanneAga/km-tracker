import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TARGET_DISTANCE = 1000; // metres
const STORAGE_KEY = '@km_tracker_history';
const RING_RADIUS = 110;
const RING_CX = 125;
const RING_CY = 125;
const RING_THICKNESS = 14;

// ─── Helpers ────────────────────────────────────────────────────────────────

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Arc progress ring (no SVG dependency) ───────────────────────────────────

function ArcRing({ progress }) {
  const degrees = Math.min(progress, 1) * 360;
  const color = progress >= 1 ? '#00e676' : '#6c63ff';
  const dots = [];
  const step = 5;
  for (let d = 0; d < degrees; d += step) {
    const rad = ((d - 90) * Math.PI) / 180;
    const x = RING_CX + RING_RADIUS * Math.cos(rad) - RING_THICKNESS / 2;
    const y = RING_CY + RING_RADIUS * Math.sin(rad) - RING_THICKNESS / 2;
    dots.push(
      <View
        key={d}
        style={{
          position: 'absolute',
          width: RING_THICKNESS,
          height: RING_THICKNESS,
          borderRadius: RING_THICKNESS / 2,
          backgroundColor: color,
          left: x,
          top: y,
        }}
      />
    );
  }
  return <View style={StyleSheet.absoluteFill} pointerEvents="none">{dots}</View>;
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [trackingStatus, setTrackingStatus] = useState('idle'); // idle | running | done
  const [distance, setDistance] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState([]);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const locationSub = useRef(null);
  const lastCoords = useRef(null);
  const startTime = useRef(null);
  const timerInterval = useRef(null);
  const accumulatedDistance = useRef(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef(null);

  useEffect(() => {
    loadHistory();
    requestPermission();
    return () => haltTracking();
  }, []);

  useEffect(() => {
    if (trackingStatus === 'running') {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current && pulseLoop.current.stop();
      pulseAnim.setValue(1);
    }
  }, [trackingStatus]);

  async function requestPermission() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermissionGranted(status === 'granted');
  }

  async function loadHistory() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch (_) {}
  }

  async function persistRun(durationMs) {
    const run = { id: Date.now(), date: new Date().toISOString(), durationMs };
    const updated = [run, ...history];
    setHistory(updated);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (_) {}
  }

  function haltTracking() {
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }
    if (locationSub.current) {
      locationSub.current.remove();
      locationSub.current = null;
    }
  }

  async function startRun() {
    if (!permissionGranted) { requestPermission(); return; }

    setDistance(0);
    setElapsed(0);
    accumulatedDistance.current = 0;
    lastCoords.current = null;
    startTime.current = Date.now();
    setTrackingStatus('running');

    timerInterval.current = setInterval(() => {
      setElapsed(Date.now() - startTime.current);
    }, 500);

    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 3 },
      ({ coords: { latitude, longitude, accuracy, speed } }) => {
        // Discard readings with poor GPS fix or no real movement
        if (accuracy > 20) return;
        if (speed !== null && speed < 0.3) return; // < ~1 km/h, standing still

        if (lastCoords.current) {
          const delta = haversineDistance(
            lastCoords.current.latitude,
            lastCoords.current.longitude,
            latitude,
            longitude
          );
          accumulatedDistance.current += delta;
          const capped = Math.min(accumulatedDistance.current, TARGET_DISTANCE);
          setDistance(capped);

          if (accumulatedDistance.current >= TARGET_DISTANCE) {
            const finalMs = Date.now() - startTime.current;
            haltTracking();
            setElapsed(finalMs);
            setTrackingStatus('done');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            persistRun(finalMs);
          }
        }
        lastCoords.current = { latitude, longitude };
      }
    );
    locationSub.current = sub;
  }

  function stopEarly() {
    haltTracking();
    setTrackingStatus('idle');
    setDistance(0);
    setElapsed(0);
  }

  function resetRun() {
    setTrackingStatus('idle');
    setDistance(0);
    setElapsed(0);
  }

  const progress = Math.min(distance / TARGET_DISTANCE, 1);
  const progressPct = Math.round(progress * 100);
  const remaining = ((TARGET_DISTANCE - distance) / 1000).toFixed(3);

  const personalBest = history.length
    ? history.reduce((b, r) => (r.durationMs < b.durationMs ? r : b), history[0])
    : null;

  return (
    <SafeAreaProvider>
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f1a" />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={s.header}>
          <Text style={s.headerTitle}>KM Tracker</Text>
          <Text style={s.headerSub}>1 km challenge</Text>
        </View>

        {/* ── Ring gauge ── */}
        <View style={s.gaugeWrap}>
          <Animated.View style={[s.gaugeOuter, { transform: [{ scale: pulseAnim }] }]}>
            {/* Background track */}
            <View style={s.ringTrack} />
            {/* Arc progress */}
            <ArcRing progress={progress} />
            {/* Centre text */}
            <View style={s.gaugeCentre}>
              <Text style={s.distNum}>
                {distance >= TARGET_DISTANCE ? '1.000' : (distance / 1000).toFixed(3)}
              </Text>
              <Text style={s.distUnit}>km</Text>
              <Text style={s.distPct}>{progressPct}%</Text>
            </View>
          </Animated.View>
        </View>

        {/* ── Stats row ── */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statLabel}>{trackingStatus === 'done' ? 'Final Time' : 'Elapsed'}</Text>
            <Text style={s.statValue}>{formatDuration(elapsed)}</Text>
          </View>
          <View style={[s.statCard, { marginRight: 0 }]}>
            <Text style={s.statLabel}>Remaining</Text>
            <Text style={s.statValue}>{remaining} km</Text>
          </View>
        </View>

        {/* ── Finish banner ── */}
        {trackingStatus === 'done' && (
          <View style={s.finishBanner}>
            <Text style={s.finishIcon}>🏁</Text>
            <Text style={s.finishTitle}>1 km Complete!</Text>
            <Text style={s.finishSub}>Finished in {formatDuration(elapsed)}</Text>
          </View>
        )}

        {/* ── CTA button ── */}
        <View style={s.btnWrap}>
          {trackingStatus === 'idle' && (
            <TouchableOpacity
              style={[s.btn, s.btnStart, !permissionGranted && s.btnMuted]}
              onPress={startRun}
              activeOpacity={0.82}
            >
              <Text style={s.btnText}>{permissionGranted ? 'Start Run' : 'Grant Location'}</Text>
            </TouchableOpacity>
          )}
          {trackingStatus === 'running' && (
            <TouchableOpacity style={[s.btn, s.btnStop]} onPress={stopEarly} activeOpacity={0.82}>
              <Text style={s.btnText}>Stop Early</Text>
            </TouchableOpacity>
          )}
          {trackingStatus === 'done' && (
            <TouchableOpacity style={[s.btn, s.btnNew]} onPress={resetRun} activeOpacity={0.82}>
              <Text style={s.btnText}>New Run</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Personal best ── */}
        {personalBest && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Personal Best</Text>
            <View style={s.pbCard}>
              <View style={s.pbIcon}><Text style={s.pbStar}>★</Text></View>
              <View style={s.pbInfo}>
                <Text style={s.pbTime}>{formatDuration(personalBest.durationMs)}</Text>
                <Text style={s.pbDate}>{formatDate(personalBest.date)}</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── History ── */}
        {history.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Run History</Text>
            {history.map((run, i) => {
              const isPB = personalBest && run.id === personalBest.id;
              return (
                <View key={run.id} style={[s.histRow, isPB && s.histRowPB]}>
                  <View style={s.histRankWrap}>
                    <Text style={s.histRank}>#{i + 1}</Text>
                    {isPB && <Text style={s.histPBTag}>PB</Text>}
                  </View>
                  <View style={s.histInfo}>
                    <Text style={s.histDate}>{formatDate(run.date)}</Text>
                    <Text style={s.histDist}>1.000 km</Text>
                  </View>
                  <Text style={[s.histTime, isPB && s.histTimePB]}>
                    {formatDuration(run.durationMs)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Empty state ── */}
        {history.length === 0 && trackingStatus === 'idle' && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>👟</Text>
            <Text style={s.emptyText}>No runs yet. Start your first 1 km!</Text>
          </View>
        )}

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f1a' },
  scroll: { paddingHorizontal: 20, paddingTop: 16 },

  // Header
  header: { alignItems: 'center', marginBottom: 24 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  headerSub: {
    fontSize: 12,
    color: '#6c63ff',
    marginTop: 3,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },

  // Gauge
  gaugeWrap: { alignItems: 'center', marginBottom: 24 },
  gaugeOuter: {
    width: 250,
    height: 250,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringTrack: {
    position: 'absolute',
    width: 222,
    height: 222,
    borderRadius: 111,
    borderWidth: 14,
    borderColor: '#1e1e30',
    top: 14,
    left: 14,
  },
  gaugeCentre: { alignItems: 'center' },
  distNum: { fontSize: 48, fontWeight: '900', color: '#fff', lineHeight: 52 },
  distUnit: { fontSize: 15, color: '#8888aa', fontWeight: '600', letterSpacing: 2 },
  distPct: { fontSize: 13, color: '#6c63ff', marginTop: 4, fontWeight: '700' },

  // Stats row
  statsRow: { flexDirection: 'row', marginBottom: 16 },
  statCard: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a40',
    marginRight: 12,
  },
  statLabel: {
    fontSize: 10,
    color: '#5566aa',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  statValue: { fontSize: 22, fontWeight: '700', color: '#fff' },

  // Finish banner
  finishBanner: {
    backgroundColor: '#0d2b1a',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#00e676',
  },
  finishIcon: { fontSize: 34, marginBottom: 6 },
  finishTitle: { fontSize: 22, fontWeight: '800', color: '#00e676', marginBottom: 4 },
  finishSub: { fontSize: 14, color: '#aaaacc' },

  // Buttons
  btnWrap: { alignItems: 'center', marginBottom: 32 },
  btn: {
    paddingVertical: 16,
    paddingHorizontal: 56,
    borderRadius: 50,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
  },
  btnStart: { backgroundColor: '#6c63ff', shadowColor: '#6c63ff' },
  btnStop: { backgroundColor: '#ff4d4d', shadowColor: '#ff4d4d' },
  btnNew: { backgroundColor: '#00b4d8', shadowColor: '#00b4d8' },
  btnMuted: { backgroundColor: '#333355', shadowColor: 'transparent' },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 0.4 },

  // Section
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5566aa',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  // Personal best
  pbCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#ffd700',
  },
  pbIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2a2000',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  pbStar: { fontSize: 22, color: '#ffd700' },
  pbInfo: { flex: 1 },
  pbTime: { fontSize: 28, fontWeight: '900', color: '#ffd700' },
  pbDate: { fontSize: 12, color: '#5566aa', marginTop: 2 },

  // History rows
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2a2a40',
  },
  histRowPB: { borderColor: '#ffd70050', backgroundColor: '#1e1900' },
  histRankWrap: { alignItems: 'center', minWidth: 36, marginRight: 12 },
  histRank: { fontSize: 13, color: '#4455aa', fontWeight: '700' },
  histPBTag: {
    fontSize: 9,
    backgroundColor: '#ffd700',
    color: '#000',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontWeight: '800',
    marginTop: 3,
  },
  histInfo: { flex: 1 },
  histDate: { fontSize: 13, color: '#aaaacc' },
  histDist: { fontSize: 11, color: '#4455aa', marginTop: 2 },
  histTime: { fontSize: 18, fontWeight: '700', color: '#fff' },
  histTimePB: { color: '#ffd700' },

  // Empty state
  empty: { alignItems: 'center', paddingVertical: 36 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: '#4455aa', textAlign: 'center' },
});
