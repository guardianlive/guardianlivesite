import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { useLanguage } from '../stores';
import PinProtectedAction from './PinProtectedAction';
import ModifyTimeModal from './ModifyTimeModal';
import { TimerPreset } from '../services/timerPresets';

const { width } = Dimensions.get('window');
const TIMER_SIZE = width * 0.6;

interface ActiveTimerViewProps {
  timeRemaining: number;
  preset: TimerPreset | null;
  isActive: boolean;
  isLoading?: boolean; // When true, timer is frozen at duration and buttons are disabled (waiting for server confirmation)
  onModifyTime: (
    newDurationMinutes: number,
    pin: string
  ) => Promise<{
    success: boolean;
    error?: string;
    emergencyAlertTriggered?: boolean;
  }>;
  onStop: (pin: string) => Promise<{
    success: boolean;
    error?: string;
    emergencyAlertTriggered?: boolean;
  }>;
  onAlertNow: () => void;
  onGoLive?: () => void;
  onViewDetails: () => void;
  skipPinForTimerActions?: boolean; // When true, skip PIN verification for stop/modify
  safePinOpenRequest?: number;
}

export default function ActiveTimerView({
  timeRemaining,
  preset,
  isActive,
  isLoading = false,
  onModifyTime,
  onStop,
  onAlertNow,
  onGoLive,
  onViewDetails,
  skipPinForTimerActions = false,
  safePinOpenRequest = 0,
}: ActiveTimerViewProps) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  // State for Modify Time modal
  const [showModifyTimeModal, setShowModifyTimeModal] = useState(false);
  const lastSafePinOpenRequestRef = useRef(safePinOpenRequest);

  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const alertAnim = useRef(new Animated.Value(0)).current;

  // Pulse animation for the outer ring
  useEffect(() => {
    if (isActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1500,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
        ])
      ).start();

      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 10000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    } else {
      pulseAnim.setValue(1);
      rotateAnim.setValue(0);
    }
  }, [isActive]);

  // Alert animation for last 10 seconds
  useEffect(() => {
    if (timeRemaining <= 10 && timeRemaining > 0) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(alertAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: false,
          }),
          Animated.timing(alertAnim, {
            toValue: 0,
            duration: 500,
            useNativeDriver: false,
          }),
        ])
      ).start();
    } else {
      alertAnim.setValue(0);
    }
  }, [timeRemaining]);

  useEffect(() => {
    if (
      safePinOpenRequest > 0 &&
      safePinOpenRequest !== lastSafePinOpenRequestRef.current &&
      skipPinForTimerActions &&
      !isLoading
    ) {
      lastSafePinOpenRequestRef.current = safePinOpenRequest;
      void onStop('');
      return;
    }

    lastSafePinOpenRequestRef.current = safePinOpenRequest;
  }, [safePinOpenRequest, skipPinForTimerActions, isLoading, onStop]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const _alertColor = alertAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.primary, Colors.red],
  });

  const alertBackground = alertAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(0,0,0,0)', 'rgba(255,0,0,0.1)'],
  });

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate dynamic font size based on timer duration
  // Shrink font when hours >= 10 (2-digit hours) to fit within circle
  const getTimerFontSize = (): number => {
    const hours = Math.floor(timeRemaining / 3600);
    if (hours >= 100) {
      return 36; // 3-digit hours (100h+)
    } else if (hours >= 10) {
      return 44; // 2-digit hours (10h-99h)
    }
    return 56; // Default size for single-digit hours or minutes-only
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.black} />

      {/* Dynamic Background */}
      <Animated.View
        style={[styles.alertBackground, { backgroundColor: alertBackground }]}
      />

      <View
        style={[
          styles.content,
          { paddingTop: insets.top + 4, paddingBottom: 96 + insets.bottom },
        ]}
      >
        {/* Header Section */}
        <View style={styles.header}>
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>
              {t('countdown.active').toUpperCase()}
            </Text>
          </View>
          <Text
            style={styles.presetName}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {preset?.label || 'Safety Timer'}
          </Text>
        </View>

        {/* Main Timer Display */}
        <View style={styles.timerWrapper}>
          {/* Rotating Gradient Ring */}
          <Animated.View
            style={[
              styles.ringContainer,
              { transform: [{ rotate: spin }, { scale: pulseAnim }] },
            ]}
          >
            <LinearGradient
              colors={[
                Colors.primary,
                Colors.primaryStart,
                'transparent',
                'transparent',
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradientRing}
            />
          </Animated.View>

          {/* Static Inner Circle */}
          <View style={styles.timerCircle}>
            <Animated.Text
              style={[
                styles.timerText,
                {
                  color: timeRemaining <= 10 ? Colors.red : Colors.white,
                  fontSize: getTimerFontSize(),
                },
              ]}
              allowFontScaling={false}
              adjustsFontSizeToFit
              numberOfLines={1}
            >
              {formatTime(timeRemaining)}
            </Animated.Text>
            <Text style={styles.timerLabel} allowFontScaling={false}>
              {t('countdown.remaining')}
            </Text>
          </View>
        </View>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Ionicons name="location-outline" size={20} color={Colors.gray400} />
          <Text style={styles.infoText}>
            Location sharing is active. Emergency contacts will be notified if
            timer expires.
          </Text>
        </View>

        {/* Action Buttons */}
        <View
          style={[styles.actionsContainer, isLoading && styles.actionsDisabled]}
        >
          {/* Stop Button (Primary) */}
          <View style={styles.primaryButtonContainer}>
            {skipPinForTimerActions ? (
              // Skip PIN - direct action
              <TouchableOpacity
                style={[
                  styles.glassButton,
                  { backgroundColor: `${Colors.success}15` },
                ]}
                onPress={() => onStop('')}
                activeOpacity={0.8}
                disabled={isLoading}
              >
                <LinearGradient
                  colors={[
                    'rgba(255, 255, 255, 0.08)',
                    'rgba(255, 255, 255, 0.02)',
                  ]}
                  style={styles.glassButtonGradient}
                >
                  <Ionicons
                    name="shield-checkmark"
                    size={28}
                    color={Colors.success}
                    style={styles.buttonIcon}
                  />
                  <View>
                    <Text style={styles.stopButtonTitle}>I AM SAFE</Text>
                    <Text style={styles.stopButtonSubtitle}>Stop Timer</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <PinProtectedAction
                onAction={onStop}
                actionTitle="I'm Safe"
                actionSubtitle="Enter PIN to confirm safety and stop timer"
                openTrigger={safePinOpenRequest}
              >
                {(showPinInput) => (
                  <TouchableOpacity
                    style={[
                      styles.glassButton,
                      { backgroundColor: `${Colors.success}15` },
                    ]}
                    onPress={showPinInput}
                    activeOpacity={0.8}
                    disabled={isLoading}
                  >
                    <LinearGradient
                      colors={[
                        'rgba(255, 255, 255, 0.08)',
                        'rgba(255, 255, 255, 0.02)',
                      ]}
                      style={styles.glassButtonGradient}
                    >
                      <Ionicons
                        name="shield-checkmark"
                        size={28}
                        color={Colors.success}
                        style={styles.buttonIcon}
                      />
                      <View>
                        <Text style={styles.stopButtonTitle}>I AM SAFE</Text>
                        <Text style={styles.stopButtonSubtitle}>
                          Stop Timer
                        </Text>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </PinProtectedAction>
            )}
          </View>

          {/* Alert Now Button */}
          <TouchableOpacity
            style={[
              styles.glassButton,
              { backgroundColor: `${Colors.danger}15` },
            ]}
            onPress={onAlertNow}
            activeOpacity={0.8}
            disabled={isLoading}
          >
            <LinearGradient
              colors={[
                'rgba(255, 255, 255, 0.08)',
                'rgba(255, 255, 255, 0.02)',
              ]}
              style={styles.glassButtonGradient}
            >
              <Ionicons
                name="warning"
                size={24}
                color={Colors.red}
                style={{ marginRight: 12 }}
              />
              <Text style={styles.alertButtonText}>ALERT NOW</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Go Live Button */}
          {onGoLive && (
            <TouchableOpacity
              style={[
                styles.glassButton,
                { backgroundColor: 'rgba(59, 130, 246, 0.15)' },
              ]}
              onPress={onGoLive}
              activeOpacity={0.8}
              disabled={isLoading}
            >
              <LinearGradient
                colors={[
                  'rgba(255, 255, 255, 0.08)',
                  'rgba(255, 255, 255, 0.02)',
                ]}
                style={styles.glassButtonGradient}
              >
                <Ionicons
                  name="videocam"
                  size={24}
                  color="#3B82F6"
                  style={{ marginRight: 12 }}
                />
                <Text style={[styles.alertButtonText, { color: '#3B82F6' }]}>
                  GO LIVE
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* Timer Details and Restart Buttons Row */}
          <View style={styles.secondaryActionsRow}>
            {/* Timer Details Button */}
            <TouchableOpacity
              style={[styles.glassButton, styles.secondaryButton]}
              onPress={onViewDetails}
              activeOpacity={0.7}
              disabled={isLoading}
            >
              <LinearGradient
                colors={[
                  'rgba(255, 255, 255, 0.08)',
                  'rgba(255, 255, 255, 0.02)',
                ]}
                style={styles.glassButtonGradient}
              >
                <Ionicons
                  name="information-circle"
                  size={20}
                  color={Colors.gray400}
                />
                <Text style={styles.restartButtonText}>Timer Details</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Modify Time Button */}
            <TouchableOpacity
              style={[styles.glassButton, styles.secondaryButton]}
              onPress={() => setShowModifyTimeModal(true)}
              activeOpacity={0.7}
              disabled={isLoading}
            >
              <LinearGradient
                colors={[
                  'rgba(255, 255, 255, 0.08)',
                  'rgba(255, 255, 255, 0.02)',
                ]}
                style={styles.glassButtonGradient}
              >
                <Ionicons
                  name="time-outline"
                  size={20}
                  color={Colors.gray400}
                />
                <Text style={styles.restartButtonText}>
                  {t('countdown.modifyTime') || 'Modify Time'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Modify Time Modal */}
      <ModifyTimeModal
        visible={showModifyTimeModal}
        currentTimeRemaining={timeRemaining}
        onClose={() => setShowModifyTimeModal(false)}
        onConfirm={onModifyTime}
        skipPinVerification={skipPinForTimerActions}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actionsContainer: {
    gap: 12,
    width: '100%',
  },
  actionsDisabled: {
    opacity: 0.4,
  },
  alertBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  alertButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  buttonIcon: {
    marginRight: 12,
  },
  container: {
    backgroundColor: Colors.black,
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  glassButton: {
    borderRadius: 20,
    overflow: 'hidden',
    // Removed borderWidth as it's now handled by the gradient
  },
  glassButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 20, // Match button radius
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  gradientRing: {
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: TIMER_SIZE / 2,
    borderWidth: 2,
    height: '100%',
    opacity: 0.3,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    marginTop: -14,
  },
  infoCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    flexDirection: 'row',
    marginVertical: 10,
    padding: 12,
  },
  infoText: {
    color: Colors.gray400,
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    marginLeft: 12,
  },
  presetName: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '500',
    opacity: 0.8,
  },
  primaryButtonContainer: {
    elevation: 8,
    shadowColor: Colors.success,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    width: '100%',
  },
  restartButtonText: {
    color: Colors.gray400,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  ringContainer: {
    alignItems: 'center',
    borderRadius: TIMER_SIZE / 2,
    height: TIMER_SIZE,
    justifyContent: 'center',
    position: 'absolute',
    width: TIMER_SIZE,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    flex: 1,
  },
  statusBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: 'rgba(34, 197, 94, 0.2)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusDot: {
    backgroundColor: Colors.success,
    borderRadius: 3,
    height: 6,
    marginRight: 8,
    width: 6,
  },
  statusText: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  stopButtonSubtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '500',
  },
  stopButtonTitle: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  timerCircle: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderColor: 'rgba(255,255,255,0.05)',
    borderRadius: (TIMER_SIZE - 40) / 2,
    borderWidth: 1,
    elevation: 10,
    height: TIMER_SIZE - 40,
    justifyContent: 'center',
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    width: TIMER_SIZE - 40,
  },
  timerLabel: {
    color: Colors.gray500,
    fontSize: 12,
    letterSpacing: 2,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  timerText: {
    color: Colors.white,
    fontSize: 56,
    fontVariant: ['tabular-nums'],
    fontWeight: '300',
    letterSpacing: -2,
  },
  timerWrapper: {
    alignItems: 'center',
    height: TIMER_SIZE,
    justifyContent: 'center',
    marginVertical: 20,
  },
});
