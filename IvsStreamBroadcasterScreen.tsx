import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
  } from 'react';
  import {
    Alert,
    BackHandler,
    FlatList,
    Image,
    InteractionManager,
    Keyboard,
    KeyboardAvoidingView,
    LayoutChangeEvent,
    Linking,
    Modal,
    Platform,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
  } from 'react-native';
  import { TapGestureHandler, State } from 'react-native-gesture-handler';
  import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
  import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
  import { Ionicons } from '@expo/vector-icons';
  import { Camera } from 'expo-camera';
  import * as FileSystem from 'expo-file-system/legacy';
  import { useKeepAwake } from 'expo-keep-awake';
  import { useSafeAreaInsets } from 'react-native-safe-area-context';
  
  import {
    BackCamera,
    type ArchiveSegment,
    BroadcastStage,
    FrontCamera,
    archiveUploadQueue,
    default as ExpoIvsBroadcast,
    type BroadcastStatusEventPayload,
    type RecordingArtifacts,
    useIvsBroadcast,
  } from 'expo-ivs-broadcast';
  
  import { COMPOSITE_CAMERA_ASPECT_RATIO } from '../components/CompositeCameraPlaybackSurface';
  import ModifyTimeModal from '../components/ModifyTimeModal';
  import PinProtectedAction from '../components/PinProtectedAction';
  import { ShieldLoaderOverlay } from '../components/ShieldLoader';
  import { Colors } from '../constants/colors';
  import { activeTimersService } from '../services/activeTimers';
  import { locationService } from '../services/location';
  import { pinService } from '../services/pinService';
  import { streamArchiveService } from '../services/streamArchiveService';
  import {
    streamChatService,
    StreamChatRoom,
  } from '../services/streamChatService';
  import { streamSessionsService } from '../services/streamSessionsService';
  import {
    completeTimerOffline,
    confirmSafetyOffline,
    updateTimerDurationOffline,
  } from '../services/networkAwareService';
  import { supabase } from '../services/supabase';
  import { liveActivitiesService } from '../services/liveActivities';
  import type { ActiveTimer } from '@guardianlive/shared';
  import { timerAlertsService, TimerAlertsConfig } from '../services/timerAlerts';
  import { useAuth, useLanguage, useUserPreferences } from '../stores';
  import type { RootStackParamList } from '../types/navigation';
  import type {
    StreamChatMessage,
    StreamPresenceState,
    StreamSession,
  } from '../types/streaming';
  import { logger } from '../utils/logger';
  
  type RouteParams = RouteProp<RootStackParamList, 'StreamBroadcaster'>;
  type BroadcasterNavigation = NativeStackNavigationProp<
    RootStackParamList,
    'StreamBroadcaster'
  >;
  
  const spacerStyle = { width: 16 };
  const ARCHIVE_SEGMENT_DURATION_SECONDS = 4;
  const ARCHIVE_LAYOUT_MODE = 'standard';
  // Keep raw camera archives available so history can fall back when IVS composites are bad.
  const ARCHIVE_UPLOAD_MODE = 'liveMirror';
  // `BroadcastStage` uses `previewContentMode="cover"`, so a tiny inset margin gets
  // cropped away on portrait screens. Keep a modest measured offset so the visible
  // on-screen PiP still has a small side margin after native preview cropping.
  const PIP_MARGIN = 16;
  const SIDE_BY_SIDE_LIVE_CONFIG = {
    width: 900,
    height: 810,
    fps: 24,
    targetBitrate: 2_800_000,
    minBitrate: 1_800_000,
    maxBitrate: 3_400_000,
    initialBitrate: 2_400_000,
    keyframeIntervalSeconds: 2,
  } as const;
  const SIDE_BY_SIDE_LAYOUT_CONFIG = {
    preset: 'pip',
    primaryCamera: 'back',
    insetCamera: 'front',
    insetCorner: 'topRight',
    insetRect: { x: 0.64, y: 0.17, width: 0.22, height: 0.22 },
    mirrorFrontPreview: false,
    mirrorFrontOutput: false,
  } as const;
  
  const messageStyles = StyleSheet.create({
    messageAvatar: {
      borderRadius: 16,
      height: 32,
      width: 32,
    },
    messageAvatarContainer: {
      marginRight: 8,
    },
    messageAvatarInitial: {
      color: 'white',
      fontSize: 10,
      fontWeight: 'bold',
    },
    messageAvatarPlaceholder: {
      alignItems: 'center',
      backgroundColor: '#555',
      justifyContent: 'center',
    },
    messageContent: {
      flex: 1,
      justifyContent: 'center',
    },
    messageRow: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      marginBottom: 12,
    },
    messageText: {
      color: 'white',
      fontSize: 14,
      textShadowColor: 'rgba(0,0,0,0.8)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 2,
    },
    messageUser: {
      color: 'white',
      fontSize: 13,
      fontWeight: 'bold',
      marginBottom: 2,
    },
  });
  
  const ChatMessageRow = React.memo(
    ({
      message,
      currentUserId,
    }: {
      message: StreamChatMessage;
      currentUserId?: string;
    }) => {
      if (!message.message_text?.trim()) return null;
  
      const name =
        message.profile?.full_name ||
        message.profile?.username ||
        (message.user_id === currentUserId ? 'You' : 'Viewer');
      const avatarUrl = message.profile?.avatar_url;
  
      return (
        <View style={messageStyles.messageRow}>
          <View style={messageStyles.messageAvatarContainer}>
            {avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                style={messageStyles.messageAvatar}
              />
            ) : (
              <View
                style={[
                  messageStyles.messageAvatar,
                  messageStyles.messageAvatarPlaceholder,
                ]}
              >
                <Text style={messageStyles.messageAvatarInitial}>
                  {name.charAt(0).toUpperCase() || '?'}
                </Text>
              </View>
            )}
          </View>
          <View style={messageStyles.messageContent}>
            <Text style={messageStyles.messageUser}>{name}</Text>
            <Text style={messageStyles.messageText}>{message.message_text}</Text>
          </View>
        </View>
      );
    }
  );
  ChatMessageRow.displayName = 'ChatMessageRow';
  
  const timerDisplayStyles = StyleSheet.create({
    container: {
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    expired: {
      backgroundColor: Colors.red,
    },
    text: {
      color: 'white',
      fontSize: 20,
      fontWeight: 'bold',
    },
  });
  
  const TimerDisplay = React.memo(
    ({
      initialSeconds,
      onExpire,
      onTimeUpdate,
      onPress,
      forceExpired,
    }: {
      initialSeconds: number;
      onExpire: () => void;
      onTimeUpdate?: (timeLeft: number, status: 'active' | 'expired') => void;
      onPress?: () => void;
      forceExpired?: boolean;
    }) => {
      const [displayTime, setDisplayTime] = useState(initialSeconds);
      const [timerUiStatus, setTimerUiStatus] = useState<'active' | 'expired'>(
        initialSeconds <= 0 ? 'expired' : 'active'
      );
  
      const endTimeRef = useRef(Date.now() + initialSeconds * 1000);
      const rafRef = useRef<number | null>(null);
      const lastDisplayedSecondRef = useRef(initialSeconds);
      const lastNotifiedSecondRef = useRef(initialSeconds);
      const isExpiredRef = useRef(initialSeconds <= 0);
  
      const formatTime = useCallback((seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      }, []);
  
      useEffect(() => {
        if (forceExpired) {
          isExpiredRef.current = true;
          setTimerUiStatus('expired');
          if (rafRef.current !== null) {
            globalThis.cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
        }
      }, [forceExpired]);
  
      useEffect(() => {
        if (isExpiredRef.current) return;
  
        let frameCount = 0;
  
        const updateFrame = () => {
          frameCount++;
  
          if (frameCount % 6 !== 0) {
            rafRef.current = globalThis.requestAnimationFrame(updateFrame);
            return;
          }
  
          const now = Date.now();
          const remainingMs = endTimeRef.current - now;
          const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  
          if (remainingSeconds !== lastDisplayedSecondRef.current) {
            lastDisplayedSecondRef.current = remainingSeconds;
            setDisplayTime(remainingSeconds);
  
            if (remainingSeconds <= 0) {
              isExpiredRef.current = true;
              setTimerUiStatus('expired');
              onExpire();
              return;
            }
          }
  
          if (
            remainingSeconds !== lastNotifiedSecondRef.current &&
            onTimeUpdate
          ) {
            lastNotifiedSecondRef.current = remainingSeconds;
            void Promise.resolve().then(() => {
              onTimeUpdate(
                remainingSeconds,
                remainingSeconds <= 0 ? 'expired' : 'active'
              );
            });
          }
  
          if (!isExpiredRef.current) {
            rafRef.current = globalThis.requestAnimationFrame(updateFrame);
          }
        };
  
        rafRef.current = globalThis.requestAnimationFrame(updateFrame);
  
        return () => {
          if (rafRef.current !== null) {
            globalThis.cancelAnimationFrame(rafRef.current);
          }
        };
      }, [onExpire, onTimeUpdate]);
  
      const content = (
        <View
          style={[
            timerDisplayStyles.container,
            timerUiStatus === 'expired' && timerDisplayStyles.expired,
          ]}
        >
          <Text style={timerDisplayStyles.text}>
            {timerUiStatus === 'expired' ? 'AT RISK' : formatTime(displayTime)}
          </Text>
        </View>
      );
  
      if (onPress && timerUiStatus !== 'expired') {
        return (
          <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
            {content}
          </TouchableOpacity>
        );
      }
  
      return content;
    }
  );
  TimerDisplay.displayName = 'TimerDisplay';
  
  const viewerCountStyles = StyleSheet.create({
    closeButton: {
      padding: 4,
    },
    container: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: 8,
      flexDirection: 'row',
      padding: 8,
    },
    emptyText: {
      color: 'rgba(255, 255, 255, 0.5)',
      fontSize: 14,
      paddingVertical: 20,
      textAlign: 'center',
    },
    modalContent: {
      backgroundColor: '#1E1E1E',
      borderColor: 'rgba(255, 255, 255, 0.1)',
      borderRadius: 20,
      borderWidth: 1,
      maxHeight: '60%',
      maxWidth: 320,
      padding: 20,
      width: '100%',
    },
    modalHeader: {
      alignItems: 'center',
      borderBottomColor: 'rgba(255, 255, 255, 0.1)',
      borderBottomWidth: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 16,
      paddingBottom: 16,
    },
    modalOverlay: {
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      flex: 1,
      justifyContent: 'center',
      padding: 24,
    },
    modalTitle: {
      color: 'white',
      fontSize: 18,
      fontWeight: 'bold',
    },
    text: {
      color: 'white',
      fontWeight: 'bold',
      marginLeft: 8,
    },
    viewerAvatar: {
      borderRadius: 20,
      height: 40,
      marginRight: 12,
      width: 40,
    },
    viewerAvatarPlaceholder: {
      alignItems: 'center',
      backgroundColor: Colors.gray600,
      justifyContent: 'center',
    },
    viewerInitial: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
    viewerItem: {
      alignItems: 'center',
      borderBottomColor: 'rgba(255, 255, 255, 0.05)',
      borderBottomWidth: 1,
      flexDirection: 'row',
      paddingVertical: 12,
    },
    viewerName: {
      color: 'white',
      flex: 1,
      fontSize: 16,
      fontWeight: '500',
    },
  });
  
  const IvsViewerCount = React.memo(
    ({ presence }: { presence: StreamPresenceState }) => {
      const [showViewers, setShowViewers] = useState(false);
      const count = Math.max(0, presence.viewers);
      const viewers = useMemo(
        () => presence.members.filter((m) => m.role === 'viewer'),
        [presence.members]
      );
  
      return (
        <>
          <TouchableOpacity
            style={viewerCountStyles.container}
            onPress={() => setShowViewers(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="eye" size={20} color="white" />
            <Text style={viewerCountStyles.text}>{count}</Text>
          </TouchableOpacity>
  
          <Modal
            visible={showViewers}
            transparent
            animationType="fade"
            onRequestClose={() => setShowViewers(false)}
          >
            <TouchableOpacity
              style={viewerCountStyles.modalOverlay}
              activeOpacity={1}
              onPress={() => setShowViewers(false)}
            >
              <TouchableOpacity
                style={viewerCountStyles.modalContent}
                activeOpacity={1}
                onPress={(e) => e.stopPropagation()}
              >
                <View style={viewerCountStyles.modalHeader}>
                  <Text style={viewerCountStyles.modalTitle}>
                    {count} {count === 1 ? 'Viewer' : 'Viewers'}
                  </Text>
                  <TouchableOpacity
                    style={viewerCountStyles.closeButton}
                    onPress={() => setShowViewers(false)}
                  >
                    <Ionicons name="close" size={24} color="white" />
                  </TouchableOpacity>
                </View>
  
                <ScrollView showsVerticalScrollIndicator={false}>
                  {viewers.length === 0 ? (
                    <Text style={viewerCountStyles.emptyText}>
                      No viewers yet
                    </Text>
                  ) : (
                    viewers.map((viewer) => (
                      <View key={viewer.key} style={viewerCountStyles.viewerItem}>
                        {viewer.avatarUrl ? (
                          <Image
                            source={{ uri: viewer.avatarUrl }}
                            style={viewerCountStyles.viewerAvatar}
                          />
                        ) : (
                          <View
                            style={[
                              viewerCountStyles.viewerAvatar,
                              viewerCountStyles.viewerAvatarPlaceholder,
                            ]}
                          >
                            <Text style={viewerCountStyles.viewerInitial}>
                              {viewer.name?.charAt(0)?.toUpperCase() || '?'}
                            </Text>
                          </View>
                        )}
                        <Text
                          style={viewerCountStyles.viewerName}
                          numberOfLines={1}
                        >
                          {viewer.name || 'Anonymous'}
                        </Text>
                      </View>
                    ))
                  )}
                </ScrollView>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        </>
      );
    }
  );
  IvsViewerCount.displayName = 'IvsViewerCount';
  
  export default function IvsStreamBroadcasterScreen() {
    useKeepAwake();
  
    const navigation = useNavigation<BroadcasterNavigation>();
    const route = useRoute<RouteParams>();
    const safeAreaInsets = useSafeAreaInsets();
    const { t } = useLanguage();
    const { isPreferenceEnabled } = useUserPreferences();
    const preset = route.params?.preset;
    const routeRemainingSeconds = route.params?.remainingSeconds;
    const { activeTimerId: routeTimerId, existingStreamCallId } =
      route.params ?? {};
    const { user } = useAuth();
  
    const [timerId, setTimerId] = useState<string | null>(routeTimerId ?? null);
    const [session, setSession] = useState<StreamSession | null>(null);
    const [isInitializing, setIsInitializing] = useState(true);
    const [isStopping, setIsStopping] = useState(false);
    const [currentTimerSeconds, setCurrentTimerSeconds] = useState(
      (preset?.minutes ?? 15) * 60
    );
    const [timerKey, setTimerKey] = useState(0);
    const [timerStatus, setTimerStatus] = useState<'active' | 'expired'>(
      'active'
    );
    const timeLeftRef = useRef(currentTimerSeconds);
    const [chatRoom, setChatRoom] = useState<StreamChatRoom | null>(null);
    const [messages, setMessages] = useState<StreamChatMessage[]>([]);
    const [presence, setPresence] = useState<StreamPresenceState>({
      viewers: 0,
      members: [],
    });
    const [showMessageModal, setShowMessageModal] = useState(false);
    const [stopMessage, setStopMessage] = useState('');
    const [pendingPinAction, setPendingPinAction] = useState<(() => void) | null>(
      null
    );
    const [showModifyTimeModal, setShowModifyTimeModal] = useState(false);
    const [showEmergencyCallModal, setShowEmergencyCallModal] = useState(false);
  
    const stopRequestedRef = useRef(false);
    const sessionRef = useRef<StreamSession | null>(null);
    const latestArtifactsRef = useRef<RecordingArtifacts | null>(null);
    const latestHealthRef = useRef<{
      status: BroadcastStatusEventPayload['status'];
      transmission?: BroadcastStatusEventPayload['transmission'];
    }>({
      status: 'idle',
    });
    const initStartedRef = useRef(false);
    const [stageLayout, setStageLayout] = useState({ width: 0, height: 0 });
  
    const handleBroadcastStatusEvent = useCallback(
      (event: BroadcastStatusEventPayload) => {
        latestHealthRef.current = {
          status: event.status,
          transmission: event.transmission,
        };
        archiveUploadQueue.updateStreamHealth({
          status: event.status,
          transmission: event.transmission,
          thermalState: event.thermalState,
        });
  
        if (event.segment) {
          void archiveUploadQueue
            .enqueueSegment(normalizeArchiveSegment(event.segment))
            .catch((error) => {
              logger.sentry('Failed to enqueue archive segment', error, {
                screen: 'IvsStreamBroadcasterScreen',
                sessionId: event.segment?.sessionId,
              });
            });
        }
      },
      []
    );
  
    const normalizeArchiveSegment = useCallback(
      (segment: ArchiveSegment): ArchiveSegment => {
        const localPath =
          segment.localPath.startsWith('file://') ||
          !segment.localPath.startsWith('/')
            ? segment.localPath
            : `file://${segment.localPath}`;
        const startedAtMs = Date.parse(segment.startedAt);
        const endedAt =
          Number.isFinite(startedAtMs) && segment.durationMs > 0
            ? new Date(startedAtMs + segment.durationMs).toISOString()
            : segment.startedAt;
        const transmission = latestHealthRef.current.transmission;
        const isRecoverySegment =
          latestHealthRef.current.status === 'disconnected' ||
          latestHealthRef.current.status === 'error' ||
          (transmission?.networkHealth
            ? ['poor', 'bad', 'degraded'].includes(
                transmission.networkHealth.toLowerCase()
              )
            : false) ||
          (typeof transmission?.rttMs === 'number' && transmission.rttMs >= 1500);
  
        return {
          ...segment,
          localPath,
          endedAt,
          uploadMode: ARCHIVE_UPLOAD_MODE,
          layoutMode: ARCHIVE_LAYOUT_MODE,
          coverageMetadata: {
            healthAtCapture: latestHealthRef.current.status,
            transmission: transmission ?? null,
          },
          isRecoverySegment,
        };
      },
      []
    );
  
    const {
      activeCameraMode,
      isPreparingPreview,
      latestArtifacts,
      layout,
      preparePreview,
      setLayout,
      startStream,
      stopStream,
      swapCameraFocus,
    } = useIvsBroadcast({
      autoPreparePreview: false,
      onStatusEvent: handleBroadcastStatusEvent,
    });
  
    useEffect(() => {
      latestArtifactsRef.current = latestArtifacts;
    }, [latestArtifacts]);
  
    useEffect(() => {
      sessionRef.current = session;
    }, [session]);
  
    useEffect(() => {
      void archiveUploadQueue.initialize().catch((error) => {
        logger.sentry('Failed to initialize archive upload queue', error, {
          screen: 'IvsStreamBroadcasterScreen',
        });
      });
    }, []);
  
    const hapticEnabled = useMemo(
      () => isPreferenceEnabled('haptic_feedback'),
      [isPreferenceEnabled]
    );
  
    const timerAlertsConfig = useMemo<TimerAlertsConfig>(
      () => ({
        totalDurationSeconds: currentTimerSeconds,
        hapticEnabled,
        timerLabel: preset?.label,
        noReminders: preset?.no_reminders || false,
      }),
      [currentTimerSeconds, hapticEnabled, preset?.label, preset?.no_reminders]
    );
  
    const handleTimerExpire = useCallback(() => {
      setTimerStatus('expired');
    }, []);
  
    const handleTimerUpdate = useCallback(
      (newTimeLeft: number, statusUpdate: 'active' | 'expired') => {
        timeLeftRef.current = newTimeLeft;
        if (statusUpdate === 'active' && timerId && newTimeLeft > 0) {
          InteractionManager.runAfterInteractions(() => {
            timerAlertsService.checkAndAlert(
              timerId,
              newTimeLeft,
              timerAlertsConfig
            );
          });
        }
      },
      [timerId, timerAlertsConfig]
    );
  
    const handleModifyTime = useCallback(
      async (newDurationMinutes: number, pin: string) => {
        try {
          const shouldSkipPin = preset?.skip_pin_for_timer_actions;
  
          let result: {
            success: boolean;
            error?: string;
            emergencyAlertTriggered?: boolean;
          };
  
          if (shouldSkipPin && pin === '') {
            result = { success: true, emergencyAlertTriggered: false };
          } else {
            result = await pinService.verifyPin(pin, 'mark_safe_active', {
              timerId: timerId || undefined,
            });
          }
  
          if (result.success) {
            const newSeconds = newDurationMinutes * 60;
            setCurrentTimerSeconds(newSeconds);
            timeLeftRef.current = newSeconds;
            setTimerKey((k) => k + 1);
  
            const capturedTimerId = timerId;
            const wasEmergencyPin = result.emergencyAlertTriggered;
            const currentPreset = preset;
            const haptic = hapticEnabled;
  
            setTimeout(async () => {
              if (capturedTimerId) {
                try {
                  if (wasEmergencyPin) {
                    logger.log(
                      '🚨 Emergency PIN used during IVS stream timer modification'
                    );
                  }
                  const updateResult = await updateTimerDurationOffline(
                    capturedTimerId,
                    newDurationMinutes
                  );
                  if (updateResult.success) {
                    const newExpiresAt = updateResult.data
                      ? new Date(updateResult.data.expires_at)
                      : new Date(Date.now() + newDurationMinutes * 60 * 1000);
  
                    await timerAlertsService.cancelScheduledNotifications(
                      capturedTimerId
                    );
                    const config: TimerAlertsConfig = {
                      totalDurationSeconds: newDurationMinutes * 60,
                      hapticEnabled: haptic,
                      timerLabel: currentPreset?.label || 'Stream Timer',
                      noReminders: currentPreset?.no_reminders || false,
                    };
                    await timerAlertsService.scheduleAlertNotifications(
                      capturedTimerId,
                      newExpiresAt,
                      config
                    );
                  } else {
                    logger.sentry(
                      'Failed to update IVS stream timer duration',
                      new Error(updateResult.error),
                      { screen: 'IvsStreamBroadcasterScreen' }
                    );
                  }
                } catch (updateError) {
                  logger.sentry(
                    'Error updating stream timer for modification',
                    updateError,
                    { screen: 'IvsStreamBroadcasterScreen' }
                  );
                }
              }
            }, 0);
  
            return {
              success: true,
              emergencyAlertTriggered: result.emergencyAlertTriggered,
            };
          }
          return { success: false, error: result.error };
        } catch (error) {
          logger.sentry('Error modifying stream timer', error, {
            screen: 'IvsStreamBroadcasterScreen',
          });
          return { success: false, error: 'Failed to modify timer' };
        }
      },
      [preset, timerId, hapticEnabled]
    );
  
    useEffect(() => {
      if (timerStatus === 'active' && timerId) {
        timerAlertsService.initializeTimer(timerId);
        return () => {
          timerAlertsService.cleanupTimer(timerId).catch((error) => {
            logger.sentry('Error cleaning up timer alerts:', error);
          });
        };
      }
    }, [timerStatus, timerId]);
  
    useEffect(() => {
      if (timerStatus !== 'active' || !timerId) return;
  
      const now = new Date();
      const computedExpires = new Date(
        now.getTime() + currentTimerSeconds * 1000
      );
  
      // The Live Activity service only consumes a subset of ActiveTimer
      // fields, so we pass a partial projection cast to the full row type.
      void liveActivitiesService.startOrUpdateForTimer({
        id: timerId,
        user_id: user?.id || '',
        label: preset?.label || 'Safety Stream',
        description: preset?.description ?? null,
        response_instructions: preset?.response_instructions ?? null,
        duration_minutes: Math.max(1, Math.ceil(currentTimerSeconds / 60)),
        started_at: now.toISOString(),
        expires_at: computedExpires.toISOString(),
        status: 'active',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        is_stream: true,
        notify_contact_ids: preset?.notify_contact_ids ?? null,
        skip_pin_for_timer_actions: preset?.skip_pin_for_timer_actions ?? null,
        hidden_until_expiry: preset?.hidden_until_expiry ?? null,
        no_reminders: preset?.no_reminders ?? null,
      } as unknown as ActiveTimer);
    }, [
      currentTimerSeconds,
      preset?.description,
      preset?.hidden_until_expiry,
      preset?.label,
      preset?.no_reminders,
      preset?.notify_contact_ids,
      preset?.response_instructions,
      preset?.skip_pin_for_timer_actions,
      timerId,
      timerStatus,
      user?.id,
    ]);
  
    useEffect(() => {
      if (timerStatus === 'expired') {
        void liveActivitiesService.endCurrentActivity();
      }
    }, [timerStatus]);
  
    useEffect(() => {
      return () => {
        if (chatRoom) {
          void chatRoom.disconnect();
        }
      };
    }, [chatRoom]);
  
    useEffect(() => {
      if (isInitializing) return;
  
      const backAction = () => {
        Alert.alert('Hold on!', 'You must stop the stream to exit.', [
          { text: 'Cancel', onPress: () => null, style: 'cancel' },
        ]);
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', backAction);
      return () => sub.remove();
    }, [isInitializing]);
  
    useEffect(() => {
      liveActivitiesService.setInteractionHandlers({
        onAlertNow: async (id: string) => {
          await activeTimersService.handleTimerExpiration(id, true);
          setTimerStatus('expired');
          await liveActivitiesService.endCurrentActivity();
        },
      });
      return () => {
        liveActivitiesService.clearInteractionHandlers();
      };
    }, []);
  
    useEffect(() => {
      if (!user || initStartedRef.current) return;
      initStartedRef.current = true;
  
      const initialize = async () => {
        let createdTimerId: string | null = null;
  
        try {
          setIsInitializing(true);
          await requestPermissions();
  
          const preview = await preparePreview();
  
          const timer = routeTimerId
            ? await activeTimersService.getTimerById(routeTimerId)
            : await activeTimersService.createActiveTimer({
                label: preset?.label ?? 'Live Stream',
                description: preset?.description,
                response_instructions: preset?.response_instructions,
                duration_minutes: preset?.minutes ?? 15,
                notify_contact_ids: preset?.notify_contact_ids,
                is_stream: true,
                stream_session_id: existingStreamCallId,
                stream_call_id: existingStreamCallId,
              });
  
          if (!timer) {
            throw new Error('Unable to load or create the active timer');
          }
  
          createdTimerId = timer.id;
          setTimerId(timer.id);
  
          const initialSeconds =
            routeRemainingSeconds !== undefined
              ? routeRemainingSeconds
              : Math.max(
                  0,
                  Math.ceil(
                    (new Date(timer.expires_at).getTime() - Date.now()) / 1000
                  )
                );
          setCurrentTimerSeconds(initialSeconds);
          timeLeftRef.current = initialSeconds;
  
          await locationService.startTracking().catch(() => undefined);
          locationService.addActiveTimerId(timer.id);
  
          const createdSession = await streamSessionsService.createSession({
            timerId: timer.id,
            activeCameraMode: preview.activeCameraMode,
            dualCameraState: preview.dualCameraState,
            title: timer.label,
            metadata: {
              source: 'guardianlive-mobile',
              dualSupported: preview.isDualCameraSupported,
            },
          });
  
          setSession(createdSession.session);
          await activeTimersService.updateTimerStreamInfo(
            timer.id,
            createdSession.session.id,
            createdSession.session.playbackUrl
          );
  
          const profileName =
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            'Broadcaster';
          const profileAvatar = user.user_metadata?.avatar_url ?? null;
  
          const room = streamChatService.createRoom({
            sessionId: createdSession.session.id,
            roomKey: createdSession.session.chatRoomKey,
            currentUser: {
              id: user.id,
              name: profileName,
              avatarUrl: profileAvatar,
              role: 'broadcaster',
            },
            onMessages: setMessages,
            onPresence: (nextPresence) => {
              setPresence(nextPresence);
              void streamSessionsService
                .setSessionStatus(createdSession.session.id, {
                  approximateViewerCount: nextPresence.viewers,
                })
                .catch(() => undefined);
            },
          });
  
          try {
            await room.connect();
            setChatRoom(room);
          } catch (chatError) {
            logger.sentry(
              'Failed to connect broadcaster stream chat room',
              chatError,
              {
                screen: 'IvsStreamBroadcasterScreen',
                sessionId: createdSession.session.id,
              }
            );
          }
  
          const archiveSession = await streamArchiveService.createArchiveSession({
            sessionId: createdSession.session.id,
            activeCameraMode: preview.activeCameraMode,
            ingestEndpoint: createdSession.session.ingestEndpoint,
            metadata: {
              source: 'guardianlive-mobile',
              dualSupported: preview.isDualCameraSupported,
              archiveLayoutMode: ARCHIVE_LAYOUT_MODE,
              recoveryUploadMode: ARCHIVE_UPLOAD_MODE,
            },
          });
  
          archiveUploadQueue.configureSession({
            sessionId: archiveSession.uploadConfig.sessionId,
            apiBaseUrl: archiveSession.uploadConfig.apiBaseUrl,
            authToken: archiveSession.uploadConfig.authToken,
            allowCellular: archiveSession.uploadConfig.allowCellular ?? false,
            maxConcurrentUploads:
              archiveSession.uploadConfig.maxConcurrentUploads ?? 1,
            uploadMode:
              archiveSession.uploadConfig.uploadMode ?? ARCHIVE_UPLOAD_MODE,
          });
  
          if (preview.activeCameraMode === 'dual') {
            await setLayout(SIDE_BY_SIDE_LAYOUT_CONFIG);
          } else {
            await setLayout({
              preset: 'singleBack',
              primaryCamera: 'back',
            });
          }
  
          const layoutConfig =
            preview.activeCameraMode === 'dual'
              ? SIDE_BY_SIDE_LAYOUT_CONFIG
              : {
                  preset: 'singleBack' as const,
                  primaryCamera: 'back' as const,
                };
  
          await startStream({
            ingestEndpoint: createdSession.session.ingestEndpoint,
            streamKey: createdSession.session.streamKey,
            liveConfig:
              preview.activeCameraMode === 'dual'
                ? SIDE_BY_SIDE_LIVE_CONFIG
                : undefined,
            layoutConfig,
            archiveConfig: {
              enabled: true,
              sessionId: createdSession.session.id,
              segmentDurationSeconds: ARCHIVE_SEGMENT_DURATION_SECONDS,
              retainLocalSegments: true,
              uploadImmediately: false,
              layoutMode: ARCHIVE_LAYOUT_MODE,
            },
            uploadConfig: archiveSession.uploadConfig,
          });
  
          const now = new Date().toISOString();
          await streamSessionsService.setSessionStatus(
            createdSession.session.id,
            {
              status: 'live',
              startedAt: now,
              metadata: {
                ...(createdSession.session.metadata ?? {}),
                dualSupported: preview.isDualCameraSupported,
                dualCameraState: preview.dualCameraState,
              },
            }
          );
  
          await supabase
            .from('active_timers')
            .update({
              stream_status: 'live',
              stream_started_at: now,
            })
            .eq('id', createdSession.session.timerId);
        } catch (error) {
          logger.sentry('Failed to initialize IVS broadcaster', error, {
            screen: 'IvsStreamBroadcasterScreen',
          });
          if (createdTimerId) {
            try {
              await completeTimerOffline(createdTimerId);
            } catch {
              /* ignore */
            }
          }
          Alert.alert(
            'Unable to start stream setup',
            error instanceof Error ? error.message : 'Unknown error'
          );
          navigation.goBack();
        } finally {
          setIsInitializing(false);
        }
      };
  
      void initialize();
      // Intentionally run once when user is available (route params read from closure at mount).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);
  
    const handleSwapCamera = useCallback(async () => {
      try {
        if (activeCameraMode === 'dual') {
          await swapCameraFocus();
        } else {
          const nextPrimary =
            (layout?.primaryCamera ?? 'back') === 'back' ? 'front' : 'back';
          await setLayout({
            preset: nextPrimary === 'front' ? 'singleFront' : 'singleBack',
            primaryCamera: nextPrimary,
          });
        }
      } catch (error) {
        Alert.alert(
          'Camera swap failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }, [activeCameraMode, layout?.primaryCamera, setLayout, swapCameraFocus]);
  
    const handleDoubleTap = useCallback(
      (event: { nativeEvent: { state: number } }) => {
        if (event.nativeEvent.state === State.ACTIVE) {
          void handleSwapCamera();
        }
      },
      [handleSwapCamera]
    );
  
    const handleEmergencyCall = useCallback(() => {
      setShowEmergencyCallModal(true);
    }, []);
  
    const confirmEmergencyCall = useCallback(async () => {
      setShowEmergencyCallModal(false);
      try {
        await Linking.openURL('tel:911');
      } catch (error) {
        logger.sentry('Error making emergency call:', error);
        Alert.alert(
          'Error',
          'Unable to make the call. Please dial 911 manually.'
        );
      }
    }, []);
  
    const handleAlertNow = useCallback(async () => {
      Alert.alert(
        'Trigger Alert?',
        'This will immediately notify your emergency contacts that you need help.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'ALERT NOW',
            style: 'destructive',
            onPress: async () => {
              setTimerStatus('expired');
              await liveActivitiesService.endCurrentActivity();
  
              let timerIdToExpire = timerId;
              if (!timerIdToExpire) {
                try {
                  const activeTimer = await activeTimersService.getActiveTimer();
                  if (activeTimer) {
                    timerIdToExpire = activeTimer.id;
                    setTimerId(activeTimer.id);
                  }
                } catch (e) {
                  logger.sentry('Error finding active timer:', e);
                }
              }
  
              if (timerIdToExpire) {
                try {
                  await activeTimersService.handleTimerExpiration(
                    timerIdToExpire,
                    true
                  );
                } catch (e) {
                  logger.sentry('Error triggering alert:', e);
                }
              }
            },
          },
        ]
      );
    }, [timerId]);
  
    const waitForArchiveArtifacts = useCallback(async () => {
      const maxAttempts = 16;
  
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const moduleArtifacts = await ExpoIvsBroadcast.getLatestArtifacts().catch(
          () => null
        );
        const artifacts = moduleArtifacts ?? latestArtifactsRef.current;
  
        if (
          artifacts?.endedAt ||
          artifacts?.frontVideoPath ||
          artifacts?.backVideoPath
        ) {
          latestArtifactsRef.current = artifacts;
          return artifacts;
        }
  
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
  
      return latestArtifactsRef.current;
    }, []);
  
    const hydrateArchiveSegmentsFromManifest = useCallback(
      async (artifacts: RecordingArtifacts | null | undefined) => {
        if (!artifacts?.segmentsManifestPath) {
          return 0;
        }
  
        const manifestPath = artifacts.segmentsManifestPath.startsWith('file://')
          ? artifacts.segmentsManifestPath
          : `file://${artifacts.segmentsManifestPath}`;
  
        const manifestContents = await FileSystem.readAsStringAsync(
          manifestPath
        ).catch(() => '');
        const lines = manifestContents
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
  
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as ArchiveSegment;
            await archiveUploadQueue.enqueueSegment(
              normalizeArchiveSegment(parsed)
            );
          } catch (error) {
            logger.sentry(
              'Failed to hydrate archive segment from manifest',
              error,
              {
                screen: 'IvsStreamBroadcasterScreen',
                sessionId: artifacts.sessionId,
                line,
              }
            );
          }
        }
  
        return lines.length;
      },
      [normalizeArchiveSegment]
    );
  
    const finalizeArchiveUploads = useCallback(async (sessionId: string) => {
      const result = await archiveUploadQueue.completeSession(
        sessionId,
        'broadcaster_stop'
      );
  
      if (result.completed) {
        const status = await streamArchiveService
          .getSessionStatus(sessionId)
          .catch(() => null);
        if (status?.session?.assemblyStatus === 'failed') {
          throw new Error('Archive assembly failed after uploads completed.');
        }
        return;
      }
  
      if (result.reason === 'archive_api_unavailable') {
        throw new Error('Archive API unavailable.');
      }
  
      logger.log(
        'Archive uploads still draining after stream stop; completion deferred',
        {
          screen: 'IvsStreamBroadcasterScreen',
          sessionId,
          reason: result.reason,
          expectedSegmentCount: result.expectedSegmentCount,
        }
      );
    }, []);
  
    const runStreamStopCleanup = useCallback(
      async (opts: { wasEmergencyPin: boolean }) => {
        const sess = sessionRef.current;
        if (!sess) return;
  
        try {
          await stopStream();
  
          try {
            await streamSessionsService.endSession(sess.id, 'broadcaster_stop');
          } catch (endSessionError) {
            logger.sentry(
              'Failed to end IVS stream session before archive finalization',
              endSessionError,
              {
                screen: 'IvsStreamBroadcasterScreen',
                sessionId: sess.id,
              }
            );
          }
  
          const artifacts = await waitForArchiveArtifacts();
  
          if (!artifacts?.endedAt) {
            logger.warn(
              'IVS archive artifacts were not finalized after stream stop',
              {
                screen: 'IvsStreamBroadcasterScreen',
                sessionId: sess.id,
                artifacts,
              }
            );
          }
  
          const manifestSegmentCount =
            await hydrateArchiveSegmentsFromManifest(artifacts);
          if (manifestSegmentCount === 0) {
            logger.warn(
              'Archive manifest did not contain any finalized segments',
              {
                screen: 'IvsStreamBroadcasterScreen',
                sessionId: sess.id,
                artifacts,
              }
            );
          }
  
          await new Promise((resolve) => setTimeout(resolve, 500));
  
          await finalizeArchiveUploads(sess.id);
  
          if (!opts.wasEmergencyPin && timerId) {
            try {
              await timerAlertsService.cancelScheduledNotifications(timerId);
              await timerAlertsService.cancelAllTimerNotifications();
            } catch (cancelError) {
              logger.sentry('Failed to cancel notifications', cancelError);
            }
            await locationService.removeActiveTimerId(timerId);
          }
        } catch (error) {
          logger.sentry('Deferred IVS stream cleanup failed', error, {
            screen: 'IvsStreamBroadcasterScreen',
            sessionId: sess.id,
          });
        }
      },
      [
        finalizeArchiveUploads,
        hydrateArchiveSegmentsFromManifest,
        stopStream,
        timerId,
        waitForArchiveArtifacts,
      ]
    );
  
    const handleStopStream = useCallback(
      async (pin: string) => {
        if (!timerId || stopRequestedRef.current) {
          return { success: false, error: 'No active timer' };
        }
  
        try {
          const result = await pinService.verifyPin(pin, 'mark_safe_active', {
            timerId,
          });
          if (!result.success) {
            return { success: false, error: result.error || 'Invalid PIN' };
          }
  
          await liveActivitiesService.endCurrentActivity();
          stopRequestedRef.current = true;
          setIsStopping(true);
  
          const wasEmergencyPin = !!result.emergencyAlertTriggered;
          const expired = timerStatus === 'expired';
          const msg = stopMessage;
  
          if (!wasEmergencyPin) {
            try {
              if (expired) {
                await confirmSafetyOffline(timerId, msg);
              } else {
                await completeTimerOffline(timerId);
              }
            } catch (completeError) {
              logger.sentry(
                'Error completing timer before navigation',
                completeError,
                { screen: 'IvsStreamBroadcasterScreen' }
              );
            }
          }
  
          navigation.goBack();
  
          setTimeout(() => {
            void runStreamStopCleanup({ wasEmergencyPin });
          }, 0);
  
          return { success: true, emergencyAlertTriggered: wasEmergencyPin };
        } catch (error) {
          logger.sentry('Error stopping IVS stream', error, {
            screen: 'IvsStreamBroadcasterScreen',
          });
          return {
            success: false,
            error:
              error instanceof Error ? error.message : 'Error stopping stream',
          };
        } finally {
          stopRequestedRef.current = false;
          setIsStopping(false);
        }
      },
      [navigation, runStreamStopCleanup, stopMessage, timerId, timerStatus]
    );
  
    const chatData = useMemo(() => messages.slice(-25), [messages]);
  
    const headerTop =
      Platform.OS === 'android'
        ? (StatusBar.currentHeight || 0) + 12
        : safeAreaInsets.top + 8;
  
    const pipSize = useMemo(() => {
      const width = clamp(stageLayout.width * 0.26, 92, 124);
      return {
        width,
        height: width / COMPOSITE_CAMERA_ASPECT_RATIO,
      };
    }, [stageLayout.width]);
  
    const handleStageLayout = useCallback((event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setStageLayout((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height }
      );
    }, []);
  
    const pipFrameStyle = useMemo(
      () => ({
        width: pipSize.width,
        height: pipSize.height,
        top: headerTop + 112,
        left: Math.max(
          PIP_MARGIN,
          stageLayout.width - pipSize.width - PIP_MARGIN
        ),
      }),
      [headerTop, pipSize.height, pipSize.width, stageLayout.width]
    );
  
    const previewNode = useMemo(() => {
      if (!layout || activeCameraMode !== 'dual') {
        return layout?.primaryCamera === 'front' ? (
          <FrontCamera style={StyleSheet.absoluteFillObject} />
        ) : (
          <BackCamera style={StyleSheet.absoluteFillObject} />
        );
      }
  
      const primaryCamera = layout.primaryCamera ?? 'back';
      const MainCamera = primaryCamera === 'front' ? FrontCamera : BackCamera;
      const PipCamera = primaryCamera === 'front' ? BackCamera : FrontCamera;
      return (
        <View style={styles.dualPreviewContainer} onLayout={handleStageLayout}>
          <MainCamera
            style={styles.primaryCamera}
            mirrorPreview={false}
            mirrorOutput={false}
          />
          <PipCamera
            style={[styles.pipCamera, pipFrameStyle]}
            mirrorPreview={false}
            mirrorOutput={false}
          />
        </View>
      );
    }, [activeCameraMode, handleStageLayout, layout, pipFrameStyle]);
  
    if (isInitializing || isPreparingPreview) {
      return (
        <View style={styles.loaderRoot}>
          <ShieldLoaderOverlay
            visible
            message="Starting live stream..."
            size="xl"
            backgroundColor="black"
          />
        </View>
      );
    }
  
    return (
      <TapGestureHandler numberOfTaps={2} onHandlerStateChange={handleDoubleTap}>
        <View style={styles.container}>
          <StatusBar hidden />
          <BroadcastStage style={styles.stage} previewContentMode="cover">
            {previewNode}
          </BroadcastStage>
  
          <SafeAreaView style={styles.overlayContainer} pointerEvents="box-none">
            <View style={styles.header}>
              <IvsViewerCount presence={presence} />
  
              <TimerDisplay
                key={timerKey}
                initialSeconds={currentTimerSeconds}
                onExpire={handleTimerExpire}
                onTimeUpdate={handleTimerUpdate}
                onPress={() => setShowModifyTimeModal(true)}
                forceExpired={timerStatus === 'expired'}
              />
  
              <View style={styles.rightControls}>
                <TouchableOpacity
                  onPress={handleSwapCamera}
                  style={styles.iconButton}
                >
                  <Ionicons name="camera-reverse" size={24} color="white" />
                </TouchableOpacity>
  
                <TouchableOpacity
                  onPress={handleEmergencyCall}
                  style={[styles.iconButton, styles.emergencyButton]}
                >
                  <Text style={styles.sosText}>SOS</Text>
                </TouchableOpacity>
              </View>
            </View>
  
            <View style={styles.chatContainer} pointerEvents="box-none">
              <FlatList
                data={chatData}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <ChatMessageRow message={item} currentUserId={user?.id} />
                )}
                style={styles.chatFlatList}
                contentContainerStyle={styles.chatListContent}
                showsVerticalScrollIndicator={false}
              />
            </View>
  
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
            >
              <View style={styles.bottomControls}>
                <View style={styles.buttonRow}>
                  {timerStatus !== 'expired' && (
                    <>
                      <TouchableOpacity
                        style={[styles.flexButton, styles.alertButton]}
                        onPress={handleAlertNow}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name="warning"
                          size={24}
                          color="#FF4444"
                          style={styles.buttonIcon}
                        />
                        <Text style={[styles.buttonText, styles.alertButtonText]}>
                          ALERT
                        </Text>
                      </TouchableOpacity>
                      <View style={spacerStyle} />
                    </>
                  )}
  
                  <PinProtectedAction
                    onAction={handleStopStream}
                    actionTitle="End Stream"
                    actionSubtitle="Enter PIN to confirm safety"
                  >
                    {(showPinInput) => (
                      <TouchableOpacity
                        style={[styles.flexButton, styles.stopButton]}
                        onPress={() => {
                          if (timerStatus === 'expired') {
                            setPendingPinAction(() => showPinInput);
                            setShowMessageModal(true);
                          } else {
                            showPinInput();
                          }
                        }}
                        activeOpacity={0.8}
                        disabled={isStopping}
                      >
                        <Ionicons
                          name="stop-circle-outline"
                          size={24}
                          color="#44DD44"
                          style={styles.buttonIcon}
                        />
                        <Text style={[styles.buttonText, styles.stopButtonText]}>
                          {isStopping ? 'STOPPING...' : 'STOP'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </PinProtectedAction>
                </View>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
  
          <Modal
            visible={showMessageModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowMessageModal(false)}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalOverlay}
            >
              <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                <View style={styles.modalInner}>
                  <Text style={styles.modalTitle}>
                    {t('countdownEnd.optionalMessage') ||
                      'Optional Message for Contacts'}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    {t('countdownEnd.messagePlaceholder') ||
                      "I'm safe, sorry for the alarm..."}
                  </Text>
  
                  <TextInput
                    style={styles.messageInput}
                    placeholder={t('countdownEnd.messagePlaceholder')}
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={stopMessage}
                    onChangeText={setStopMessage}
                    multiline
                  />
  
                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.secondaryButton]}
                      onPress={() => {
                        setShowMessageModal(false);
                        setPendingPinAction(null);
                      }}
                    >
                      <Text style={styles.secondaryButtonText}>Cancel</Text>
                    </TouchableOpacity>
  
                    <TouchableOpacity
                      style={[styles.modalButton, styles.primaryButton]}
                      onPress={() => {
                        setShowMessageModal(false);
                        if (pendingPinAction) pendingPinAction();
                        setPendingPinAction(null);
                      }}
                    >
                      <Text style={styles.primaryButtonText}>
                        {t('common.continue') || 'Continue'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </Modal>
  
          <ModifyTimeModal
            visible={showModifyTimeModal}
            currentTimeRemaining={timeLeftRef.current}
            onClose={() => setShowModifyTimeModal(false)}
            onConfirm={handleModifyTime}
            skipPinVerification={preset?.skip_pin_for_timer_actions}
          />
  
          <Modal
            visible={showEmergencyCallModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowEmergencyCallModal(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.emergencyModalContent}>
                <View style={styles.emergencyIconContainer}>
                  <Ionicons name="call" size={40} color="white" />
                </View>
                <Text style={styles.emergencyModalTitle}>Call 911?</Text>
                <Text style={styles.emergencyModalSubtitle}>
                  Are you sure you want to call emergency services?
                </Text>
  
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.secondaryButton]}
                    onPress={() => setShowEmergencyCallModal(false)}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </TouchableOpacity>
  
                  <TouchableOpacity
                    style={[styles.modalButton, styles.emergencyConfirmButton]}
                    onPress={confirmEmergencyCall}
                  >
                    <Text style={styles.primaryButtonText}>Call 911</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </View>
      </TapGestureHandler>
    );
  }
  
  async function requestPermissions() {
    const camera = await Camera.requestCameraPermissionsAsync();
    const microphone = await Camera.requestMicrophonePermissionsAsync();
  
    if (!camera.granted || !microphone.granted) {
      throw new Error(
        'Camera and microphone permissions are required to broadcast.'
      );
    }
  }
  
  function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
  }
  
  const styles = StyleSheet.create({
    alertButton: {
      alignItems: 'center',
      backgroundColor: 'rgba(255, 68, 68, 0.15)',
      borderColor: '#FF4444',
      borderRadius: 28,
      borderWidth: 2,
      flexDirection: 'row',
      justifyContent: 'center',
    },
    alertButtonText: {
      color: '#FF4444',
    },
    bottomControls: {
      padding: 20,
      paddingTop: 8,
      width: '100%',
      zIndex: 11,
    },
    buttonIcon: {
      marginRight: 8,
    },
    buttonRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
    },
    buttonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: 'bold',
    },
    chatContainer: {
      flex: 1,
      justifyContent: 'flex-end',
      marginBottom: 12,
      paddingLeft: 12,
      paddingRight: 8,
      width: '75%',
      ...(Platform.OS === 'android' && { elevation: 6 }),
      zIndex: 11,
    },
    chatFlatList: {
      backgroundColor: 'transparent',
      flexGrow: 0,
      maxHeight: 220,
    },
    chatListContent: {
      flexGrow: 1,
      justifyContent: 'flex-end',
      paddingBottom: 8,
    },
    container: {
      backgroundColor: Colors.black,
      flex: 1,
    },
    dualPreviewContainer: {
      ...StyleSheet.absoluteFillObject,
    },
    emergencyButton: {
      backgroundColor: Colors.red,
      paddingHorizontal: 0,
      width: 44,
    },
    emergencyConfirmButton: {
      backgroundColor: Colors.red,
    },
    emergencyIconContainer: {
      alignItems: 'center',
      backgroundColor: Colors.red,
      borderRadius: 35,
      height: 70,
      justifyContent: 'center',
      marginBottom: 16,
      width: 70,
    },
    emergencyModalContent: {
      alignItems: 'center',
      backgroundColor: '#1E1E1E',
      borderColor: 'rgba(255, 255, 255, 0.1)',
      borderRadius: 24,
      borderWidth: 1,
      padding: 24,
      width: '100%',
    },
    emergencyModalSubtitle: {
      color: 'rgba(255, 255, 255, 0.6)',
      fontSize: 14,
      marginBottom: 24,
      textAlign: 'center',
    },
    emergencyModalTitle: {
      color: 'white',
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 8,
      textAlign: 'center',
    },
    flexButton: {
      flex: 1,
      height: 56,
    },
    header: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingBottom: 16,
      paddingHorizontal: 16,
      paddingTop: Platform.OS === 'android' ? 12 : 8,
      zIndex: 11,
    },
    iconButton: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: 20,
      height: 44,
      justifyContent: 'center',
      padding: 8,
      width: 44,
    },
    loaderRoot: {
      backgroundColor: Colors.black,
      flex: 1,
    },
    messageInput: {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      borderRadius: 12,
      color: 'white',
      fontSize: 16,
      marginBottom: 24,
      minHeight: 100,
      padding: 16,
      textAlignVertical: 'top',
    },
    modalButton: {
      alignItems: 'center',
      borderRadius: 12,
      flex: 1,
      justifyContent: 'center',
      paddingVertical: 16,
    },
    modalButtons: {
      flexDirection: 'row',
      gap: 12,
    },
    modalInner: {
      backgroundColor: '#1E1E1E',
      borderColor: 'rgba(255, 255, 255, 0.1)',
      borderRadius: 24,
      borderWidth: 1,
      padding: 24,
      width: '100%',
    },
    modalOverlay: {
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      flex: 1,
      justifyContent: 'center',
      padding: 24,
    },
    modalSubtitle: {
      color: 'rgba(255, 255, 255, 0.6)',
      fontSize: 14,
      marginBottom: 20,
      textAlign: 'center',
    },
    modalTitle: {
      color: 'white',
      fontSize: 18,
      fontWeight: 'bold',
      marginBottom: 8,
      textAlign: 'center',
    },
    overlayContainer: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'space-between',
      ...(Platform.OS === 'android' && { elevation: 5 }),
      zIndex: 10,
    },
    pipCamera: {
      backgroundColor: 'transparent',
      borderRadius: 16,
      overflow: 'hidden',
      position: 'absolute',
      zIndex: 1,
    },
    primaryButton: {
      backgroundColor: Colors.primary,
    },
    primaryButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: 'bold',
    },
    primaryCamera: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 0,
    },
    rightControls: {
      alignItems: 'center',
      gap: 12,
    },
    secondaryButton: {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    secondaryButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
    sosText: {
      color: 'white',
      fontSize: 13,
      fontWeight: '900',
    },
    stage: {
      ...StyleSheet.absoluteFillObject,
    },
    stopButton: {
      alignItems: 'center',
      backgroundColor: 'rgba(68, 221, 68, 0.15)',
      borderColor: '#44DD44',
      borderRadius: 28,
      borderWidth: 2,
      flexDirection: 'row',
      justifyContent: 'center',
    },
    stopButtonText: {
      color: '#44DD44',
    },
  });
  