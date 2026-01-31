import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
  Dimensions,
  Animated,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import FaceDetection from '@react-native-ml-kit/face-detection';
import { StatusBar } from 'expo-status-bar';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Thresholds
const THRESHOLDS = {
  CENTER_TOLERANCE: 0.22,
  HEAD_YAW_LIMIT: 18,
  HEAD_ROLL_LIMIT: 15,
  EYE_OPEN_THRESHOLD: 0.4,
  EXPRESSION_THRESHOLD: 0.12,
  MIN_FACE_SIZE: 0.15,
  MAX_FACE_SIZE: 0.80,
};

type CheckStatus = 'checking' | 'pass' | 'fail';

interface ChecklistItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  icon: string;
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('front');
  const [isReady, setIsReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [allChecksPassed, setAllChecksPassed] = useState(false);
  const [passStreak, setPassStreak] = useState(0);
  
  const [checklist, setChecklist] = useState<ChecklistItem[]>([
    { id: 'face', label: 'Face Detected', status: 'checking', detail: 'Looking...', icon: '👤' },
    { id: 'framing', label: 'Face Centered', status: 'checking', detail: 'Checking...', icon: '📐' },
    { id: 'eyeContact', label: 'Eye Contact', status: 'checking', detail: 'Checking...', icon: '👀' },
    { id: 'expression', label: 'Good Expression', status: 'checking', detail: 'Checking...', icon: '😊' },
    { id: 'headPosition', label: 'Head Position', status: 'checking', detail: 'Checking...', icon: '🎯' },
  ]);

  const cameraRef = useRef<CameraView>(null);
  const isCapturing = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const celebrationAnim = useRef(new Animated.Value(0)).current;

  // Animations
  useEffect(() => {
    if (isReady && !allChecksPassed) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isReady, allChecksPassed]);

  useEffect(() => {
    if (allChecksPassed) {
      Animated.spring(celebrationAnim, { toValue: 1, friction: 4, tension: 40, useNativeDriver: true }).start();
    } else {
      celebrationAnim.setValue(0);
    }
  }, [allChecksPassed]);

  // Analyze frame - with proper error handling
  const analyzeFrame = useCallback(async () => {
    // Only capture if camera is ready and not already capturing
    if (!cameraRef.current || !cameraReady || isCapturing.current || allChecksPassed) {
      return;
    }
    
    isCapturing.current = true;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.3,
        skipProcessing: true,
        base64: false,
        shutterSound: false,
      });

      if (!photo?.uri) {
        isCapturing.current = false;
        return;
      }

      const faces = await FaceDetection.detect(photo.uri, {
        performanceMode: 'fast',
        classificationMode: 'all',
        contourMode: 'none',
        landmarkMode: 'none',
      });

      const newChecklist = [...checklist];
      let passCount = 0;

      if (faces && faces.length > 0) {
        const face = faces[0] as any;
        
        const faceCenterX = (face.frame.left + face.frame.width / 2) / photo.width;
        const faceCenterY = (face.frame.top + face.frame.height / 2) / photo.height;
        const faceWidthRatio = face.frame.width / photo.width;
        
        const yawAngle = face.headEulerAngleY ?? face.yawAngle ?? 0;
        const rollAngle = face.headEulerAngleZ ?? face.rollAngle ?? 0;
        const smileProb = face.smilingProbability ?? 0;
        const leftEyeOpen = face.leftEyeOpenProbability ?? 0.8;
        const rightEyeOpen = face.rightEyeOpenProbability ?? 0.8;

        // 1. Face
        newChecklist[0] = { ...newChecklist[0], status: 'pass', detail: 'Visible' };
        passCount++;

        // 2. Framing
        const offX = Math.abs(faceCenterX - 0.5);
        const offY = Math.abs(faceCenterY - 0.5);
        const centered = offX < THRESHOLDS.CENTER_TOLERANCE && offY < THRESHOLDS.CENTER_TOLERANCE + 0.1;
        const goodSize = faceWidthRatio >= THRESHOLDS.MIN_FACE_SIZE && faceWidthRatio <= THRESHOLDS.MAX_FACE_SIZE;
        
        if (centered && goodSize) {
          newChecklist[1] = { ...newChecklist[1], status: 'pass', detail: 'Perfect' };
          passCount++;
        } else {
          let hint = '';
          if (!centered) hint = offX > offY ? (faceCenterX < 0.5 ? 'Move right' : 'Move left') : (faceCenterY < 0.5 ? 'Move down' : 'Move up');
          else hint = faceWidthRatio < THRESHOLDS.MIN_FACE_SIZE ? 'Move closer' : 'Move back';
          newChecklist[1] = { ...newChecklist[1], status: 'fail', detail: hint };
        }

        // 3. Eyes
        const eyesOk = leftEyeOpen > THRESHOLDS.EYE_OPEN_THRESHOLD && rightEyeOpen > THRESHOLDS.EYE_OPEN_THRESHOLD;
        const lookingOk = Math.abs(yawAngle) < THRESHOLDS.HEAD_YAW_LIMIT;
        if (eyesOk && lookingOk) {
          newChecklist[2] = { ...newChecklist[2], status: 'pass', detail: 'Great!' };
          passCount++;
        } else {
          newChecklist[2] = { ...newChecklist[2], status: 'fail', detail: !eyesOk ? 'Open eyes' : 'Look at camera' };
        }

        // 4. Expression
        if (smileProb > THRESHOLDS.EXPRESSION_THRESHOLD) {
          newChecklist[3] = { ...newChecklist[3], status: 'pass', detail: smileProb > 0.5 ? 'Great energy!' : 'Engaged' };
          passCount++;
        } else {
          newChecklist[3] = { ...newChecklist[3], status: 'fail', detail: 'Smile a bit' };
        }

        // 5. Position
        if (Math.abs(rollAngle) < THRESHOLDS.HEAD_ROLL_LIMIT) {
          newChecklist[4] = { ...newChecklist[4], status: 'pass', detail: 'Good' };
          passCount++;
        } else {
          newChecklist[4] = { ...newChecklist[4], status: 'fail', detail: 'Straighten head' };
        }

      } else {
        newChecklist[0] = { ...newChecklist[0], status: 'fail', detail: 'Not found' };
        for (let i = 1; i < 5; i++) newChecklist[i] = { ...newChecklist[i], status: 'checking', detail: 'Need face' };
      }

      setChecklist(newChecklist);

      if (passCount === 5) {
        setPassStreak(prev => {
          if (prev >= 2) setAllChecksPassed(true);
          return prev + 1;
        });
      } else {
        setPassStreak(0);
      }

    } catch (e) {
      // Silently ignore errors - camera might not be ready
      console.log('Capture skipped');
    } finally {
      isCapturing.current = false;
    }
  }, [checklist, allChecksPassed, cameraReady]);

  // Start analysis after camera is ready with a delay
  useEffect(() => {
    if (isReady && cameraReady && !allChecksPassed) {
      // Wait a moment for camera to stabilize
      const startDelay = setTimeout(() => {
        intervalRef.current = setInterval(analyzeFrame, 800); // Slower interval - less aggressive
      }, 1000); // 1 second delay before starting
      
      return () => {
        clearTimeout(startDelay);
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isReady, cameraReady, allChecksPassed, analyzeFrame]);

  const startCheck = () => {
    setIsReady(true);
    setAllChecksPassed(false);
    setPassStreak(0);
  };

  const resetCheck = () => {
    setIsReady(false);
    setAllChecksPassed(false);
    setPassStreak(0);
    isCapturing.current = false;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setChecklist([
      { id: 'face', label: 'Face Detected', status: 'checking', detail: 'Looking...', icon: '👤' },
      { id: 'framing', label: 'Face Centered', status: 'checking', detail: 'Checking...', icon: '📐' },
      { id: 'eyeContact', label: 'Eye Contact', status: 'checking', detail: 'Checking...', icon: '👀' },
      { id: 'expression', label: 'Good Expression', status: 'checking', detail: 'Checking...', icon: '😊' },
      { id: 'headPosition', label: 'Head Position', status: 'checking', detail: 'Checking...', icon: '🎯' },
    ]);
  };

  // Handle camera ready state
  const onCameraReady = () => {
    setCameraReady(true);
  };

  if (!permission) {
    return <View style={styles.container}><ActivityIndicator size="large" color="#FFF" /><Text style={styles.statusText}>Initializing...</Text></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorEmoji}>📷</Text>
        <Text style={styles.errorText}>Camera Permission Required</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}><Text style={styles.buttonText}>Grant Access</Text></TouchableOpacity>
      </View>
    );
  }

  const passedCount = checklist.filter(i => i.status === 'pass').length;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      <CameraView 
        ref={cameraRef} 
        style={StyleSheet.absoluteFill} 
        facing={facing}
        onCameraReady={onCameraReady}
      />

      <View style={styles.overlay}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerText}>Creator Readiness</Text>
          <Text style={styles.subHeader}>
            {isReady && !allChecksPassed 
              ? (cameraReady ? '● Analyzing...' : '● Starting camera...') 
              : 'Pre-Recording Check'}
          </Text>
        </View>

        {/* Content */}
        {!isReady ? (
          <View style={styles.startContainer}>
            <Text style={styles.startEmoji}>🎬</Text>
            <Text style={styles.startTitle}>Ready to Check?</Text>
            <Text style={styles.startSubtitle}>Position yourself and tap Start</Text>
            <View style={styles.checkPreview}>
              {['👤', '📐', '👀', '😊', '🎯'].map((icon, i) => (
                <View key={i} style={styles.previewBadge}><Text style={styles.previewIcon}>{icon}</Text></View>
              ))}
            </View>
          </View>
        ) : allChecksPassed ? (
          <Animated.View style={[styles.successContainer, { transform: [{ scale: Animated.add(0.9, Animated.multiply(celebrationAnim, 0.1)) }] }]}>
            <Text style={styles.successEmoji}>✅</Text>
            <Text style={styles.successTitle}>You're Ready!</Text>
            <Text style={styles.successSubtitle}>Go record your content!</Text>
            <View style={styles.passedList}>
              {checklist.map(item => (
                <View key={item.id} style={styles.passedItem}>
                  <Text>{item.icon}</Text>
                  <Text style={styles.passedLabel}>{item.label}</Text>
                  <Text style={styles.passedMark}>✓</Text>
                </View>
              ))}
            </View>
          </Animated.View>
        ) : (
          <View style={styles.checklistContainer}>
            <Animated.View style={[styles.progressRing, { transform: [{ scale: pulseAnim }] }]}>
              <Text style={styles.progressNum}>{passedCount}/5</Text>
            </Animated.View>
            <View style={styles.list}>
              {checklist.map(item => (
                <View key={item.id} style={[styles.item, item.status === 'pass' && styles.itemPass, item.status === 'fail' && styles.itemFail]}>
                  <Text style={styles.itemIcon}>{item.icon}</Text>
                  <View style={styles.itemText}>
                    <Text style={styles.itemLabel}>{item.label}</Text>
                    <Text style={[styles.itemDetail, item.status === 'pass' && { color: '#34C759' }, item.status === 'fail' && { color: '#FF9500' }]}>{item.detail}</Text>
                  </View>
                  <View style={[styles.itemStatus, item.status === 'pass' && { backgroundColor: '#34C759' }, item.status === 'fail' && { backgroundColor: '#FF3B30' }]}>
                    {item.status === 'checking' ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.itemMark}>{item.status === 'pass' ? '✓' : '✗'}</Text>}
                  </View>
                </View>
              ))}
            </View>
            {passStreak > 0 && <Text style={styles.streakText}>Hold... {passStreak}/3</Text>}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          {!isReady ? (
            <TouchableOpacity style={styles.startBtn} onPress={startCheck}><Text style={styles.startBtnText}>🚀 Start Check</Text></TouchableOpacity>
          ) : allChecksPassed ? (
            <TouchableOpacity style={styles.resetBtn} onPress={resetCheck}><Text style={styles.resetBtnText}>🔄 Again</Text></TouchableOpacity>
          ) : (
            <View style={styles.controls}>
              <TouchableOpacity style={styles.stopBtn} onPress={resetCheck}><Text style={styles.stopBtnText}>⏹️ Stop</Text></TouchableOpacity>
              <TouchableOpacity style={styles.flipBtn} onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}><Text style={styles.flipBtnText}>🔄 Flip</Text></TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', padding: 20, paddingTop: Platform.OS === 'android' ? 45 : 55 },
  header: { alignItems: 'center' },
  headerText: { color: '#FFF', fontSize: 26, fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 3 },
  subHeader: { color: '#0F0', fontSize: 13, marginTop: 3 },
  
  startContainer: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.88)', borderRadius: 20, padding: 25, marginHorizontal: 15 },
  startEmoji: { fontSize: 56, marginBottom: 12 },
  startTitle: { color: '#FFF', fontSize: 26, fontWeight: 'bold' },
  startSubtitle: { color: '#AAA', fontSize: 15, marginTop: 6 },
  checkPreview: { flexDirection: 'row', marginTop: 20, gap: 12 },
  previewBadge: { backgroundColor: 'rgba(255,255,255,0.15)', padding: 10, borderRadius: 12 },
  previewIcon: { fontSize: 22 },
  
  checklistContainer: { alignItems: 'center' },
  progressRing: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#007AFF', marginBottom: 15 },
  progressNum: { color: '#FFF', fontSize: 24, fontWeight: 'bold' },
  list: { width: '100%', gap: 5 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 12, padding: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)' },
  itemPass: { borderColor: '#34C759', backgroundColor: 'rgba(52,199,89,0.12)' },
  itemFail: { borderColor: '#FF3B30', backgroundColor: 'rgba(255,59,48,0.12)' },
  itemIcon: { fontSize: 20, marginRight: 10 },
  itemText: { flex: 1 },
  itemLabel: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  itemDetail: { color: '#AAA', fontSize: 11 },
  itemStatus: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  itemMark: { color: '#FFF', fontSize: 14, fontWeight: 'bold' },
  streakText: { color: '#0F0', fontSize: 13, marginTop: 12 },
  
  successContainer: { alignItems: 'center', backgroundColor: 'rgba(52,199,89,0.18)', borderRadius: 20, padding: 25, marginHorizontal: 15, borderWidth: 2, borderColor: '#34C759' },
  successEmoji: { fontSize: 64, marginBottom: 10 },
  successTitle: { color: '#34C759', fontSize: 28, fontWeight: 'bold' },
  successSubtitle: { color: '#FFF', fontSize: 16, marginTop: 5 },
  passedList: { marginTop: 20, width: '100%' },
  passedItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  passedLabel: { flex: 1, color: '#FFF', fontSize: 14, marginLeft: 10 },
  passedMark: { color: '#34C759', fontSize: 18, fontWeight: 'bold' },
  
  footer: { alignItems: 'center' },
  startBtn: { backgroundColor: '#007AFF', paddingHorizontal: 45, paddingVertical: 16, borderRadius: 30, elevation: 6 },
  startBtnText: { color: '#FFF', fontSize: 20, fontWeight: 'bold' },
  resetBtn: { backgroundColor: '#34C759', paddingHorizontal: 35, paddingVertical: 14, borderRadius: 25 },
  resetBtnText: { color: '#FFF', fontSize: 17, fontWeight: 'bold' },
  controls: { flexDirection: 'row', gap: 12 },
  stopBtn: { backgroundColor: '#FF3B30', paddingHorizontal: 25, paddingVertical: 12, borderRadius: 22 },
  stopBtnText: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },
  flipBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 22 },
  flipBtnText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  
  statusText: { color: '#FFF', fontSize: 16, marginTop: 15 },
  errorEmoji: { fontSize: 56, marginBottom: 15 },
  errorText: { color: '#FFF', fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  button: { backgroundColor: '#007AFF', paddingHorizontal: 25, paddingVertical: 12, borderRadius: 10, marginTop: 15 },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
