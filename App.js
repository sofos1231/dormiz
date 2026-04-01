import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  PanResponder,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Audio, Video, ResizeMode } from 'expo-av';
import {
  TAP_SOUNDS,
  SWIPE_SOUNDS,
  GREET_SOUNDS,
  RARE_SOUNDS,
  SPEAK_VIDEOS,
  IDLE_VIDEOS,
  EASTER_EGG_VIDEOS,
  ACTION_VIDEOS,
  GREAT_SONG_VIDEO,
  YES_VIDEOS,
  NO_VIDEOS,
  WELCOME_VIDEOS,
} from './config';

const HORIZONTAL_THRESHOLD = 50;
const VERTICAL_THRESHOLD = 80;
const RECORDING_DURATION_MS = 4000;
const WATCHDOG_TIMEOUT_MS = 3000;
const BUFFERING_TIMEOUT_MS = 5000;
const HOLD_MIN_MS = 500;

// History ring buffers to avoid repeats
const IDLE_HISTORY_SIZE = 3;
const SPEAK_HISTORY_SIZE = 1;
function pushHistory(arr, item, maxSize) {
  arr.push(item);
  if (arr.length > maxSize) arr.shift();
}
const recentIdleVideos = [];
const recentSpeakVideos = [];

// Guaranteed easter egg every 20 idles max
let idlesSinceLastEasterEgg = 0;

function pickNextIdle() {
  idlesSinceLastEasterEgg++;

  // Force easter egg at 20
  if (idlesSinceLastEasterEgg >= 20) {
    idlesSinceLastEasterEgg = 0;
    const vid = EASTER_EGG_VIDEOS[Math.floor(Math.random() * EASTER_EGG_VIDEOS.length)];
    pushHistory(recentIdleVideos, vid, IDLE_HISTORY_SIZE);
    return { type: 'easter', video: vid };
  }

  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const roll = Math.random() * 100;
    let pick;
    if (roll < 5) {
      idlesSinceLastEasterEgg = 0;
      pick = { type: 'easter', video: EASTER_EGG_VIDEOS[Math.floor(Math.random() * EASTER_EGG_VIDEOS.length)] };
    } else if (roll < 20) {
      pick = { type: 'idle', video: IDLE_VIDEOS.default };
    } else if (roll < 35) {
      pick = { type: 'idle', video: IDLE_VIDEOS.smoking };
    } else if (roll < 50) {
      pick = { type: 'idle', video: IDLE_VIDEOS.looking };
    } else if (roll < 65) {
      pick = { type: 'idle', video: IDLE_VIDEOS.goAndCome };
    } else if (roll < 80) {
      pick = { type: 'idle', video: IDLE_VIDEOS.idleAgain };
    } else {
      pick = { type: 'idle', video: IDLE_VIDEOS.shake };
    }
    // Default idle can always repeat; others check history
    if (pick.video === IDLE_VIDEOS.default) {
      pushHistory(recentIdleVideos, pick.video, IDLE_HISTORY_SIZE);
      return pick;
    }
    if (!recentIdleVideos.includes(pick.video)) {
      pushHistory(recentIdleVideos, pick.video, IDLE_HISTORY_SIZE);
      return pick;
    }
  }
  const fallback = { type: 'idle', video: IDLE_VIDEOS.default };
  pushHistory(recentIdleVideos, fallback.video, IDLE_HISTORY_SIZE);
  return fallback;
}

function pickSpeakVideo() {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pick = SPEAK_VIDEOS[Math.floor(Math.random() * SPEAK_VIDEOS.length)];
    if (!recentSpeakVideos.includes(pick)) {
      pushHistory(recentSpeakVideos, pick, SPEAK_HISTORY_SIZE);
      return pick;
    }
  }
  const pick = SPEAK_VIDEOS[Math.floor(Math.random() * SPEAK_VIDEOS.length)];
  pushHistory(recentSpeakVideos, pick, SPEAK_HISTORY_SIZE);
  return pick;
}

// Guaranteed rare voice line every 20 voice lines max (shared tap + swipe counter)
let voiceLinesSinceLastRare = 0;
function shouldPlayRare() {
  voiceLinesSinceLastRare++;
  if (voiceLinesSinceLastRare >= 20) {
    voiceLinesSinceLastRare = 0;
    return true;
  }
  if (Math.floor(Math.random() * 20) + 1 === 1) {
    voiceLinesSinceLastRare = 0;
    return true;
  }
  return false;
}

// Map specific sound labels to override speaking videos
function getSpeakVideoForSound(label) {
  if (label === 'YES') return YES_VIDEOS.normal;
  if (['no_no_no_no', 'nonsense', 'try_again'].includes(label)) {
    return Math.random() < 0.5 ? NO_VIDEOS.normal : NO_VIDEOS.exaggerated;
  }
  return null;
}

export default function App() {
  const [mode, setMode] = useState('normal');
  const [isRecording, setIsRecording] = useState(false);

  // ──── Double-buffered video player ────
  // Two slots (A=0, B=1) stacked on top of each other.
  // The active slot sits on top (higher zIndex). When switching videos,
  // the new video loads on the INACTIVE slot. Once it confirms isPlaying,
  // we swap which slot is on top. The old slot's last frame stays visible
  // underneath until that moment — zero black frames.
  const [slotA, setSlotA] = useState({ source: IDLE_VIDEOS.default, loop: true, key: 0 });
  const [slotB, setSlotB] = useState({ source: IDLE_VIDEOS.default, loop: false, key: 10000 });
  const [activeSlot, setActiveSlot] = useState(0);
  const activeSlotRef = useRef(0);
  const videoRefA = useRef(null);
  const videoRefB = useRef(null);

  const tapIndexRef = useRef(0);
  const swipeIndexRef = useRef(0);
  const soundRef = useRef(null);
  const recordingRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const modeRef = useRef('normal');
  const phaseRef = useRef('idle');
  const pendingActionRef = useRef(null);
  const busyRef = useRef(false);
  const watchdogRef = useRef(null);
  const bufferingTimerRef = useRef(null);
  const videoPlayingConfirmedRef = useRef(false);
  const switchIdRef = useRef(0);
  // Which slot is pending activation (waiting for isPlaying confirmation)
  const pendingSlotRef = useRef(null);
  // Idle pause: 1s freeze on first frame between idle loops
  const idlePauseTimerRef = useRef(null);
  const idlePauseSlotRef = useRef(null);   // which slot should be paused at frame 0
  // Hold-to-tap state
  const holdStartRef = useRef(null);       // timestamp when finger went down
  const holdActiveRef = useRef(false);     // true while snap first frame is shown
  const holdSlotRef = useRef(null);        // which slot has the paused snap video
  const preHoldVideoRef = useRef(null);    // snapshot of what was playing before hold
  const preHoldLoopRef = useRef(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    activeSlotRef.current = activeSlot;
  }, [activeSlot]);

  const getActiveVideoRef = useCallback(() => {
    return activeSlotRef.current === 0 ? videoRefA : videoRefB;
  }, []);

  const clearVideoTimers = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (bufferingTimerRef.current) {
      clearTimeout(bufferingTimerRef.current);
      bufferingTimerRef.current = null;
    }
    if (idlePauseTimerRef.current) {
      clearTimeout(idlePauseTimerRef.current);
      idlePauseTimerRef.current = null;
    }
    idlePauseSlotRef.current = null;
  }, []);

  // Switch video using double-buffer: load on inactive slot, swap when playing
  const switchVideo = useCallback((source, shouldLoop) => {
    clearVideoTimers();
    videoPlayingConfirmedRef.current = false;
    const newSwitchId = ++switchIdRef.current;

    const currentActive = activeSlotRef.current;
    const inactiveSlot = currentActive === 0 ? 1 : 0;
    pendingSlotRef.current = inactiveSlot;

    // Load new video on the inactive slot (key increment triggers remount)
    if (inactiveSlot === 0) {
      setSlotA(prev => ({ source, loop: shouldLoop, key: prev.key + 1 }));
    } else {
      setSlotB(prev => ({ source, loop: shouldLoop, key: prev.key + 1 }));
    }

    // Watchdog: if the new video doesn't start playing within 3s, force swap anyway
    watchdogRef.current = setTimeout(() => {
      if (!videoPlayingConfirmedRef.current && switchIdRef.current === newSwitchId) {
        console.warn('Watchdog: video did not start within 3s, forcing swap');
        setActiveSlot(inactiveSlot);
        activeSlotRef.current = inactiveSlot;
        pendingSlotRef.current = null;
      }
    }, WATCHDOG_TIMEOUT_MS);
  }, [clearVideoTimers]);

  // Emergency fallback to idle.mp4
  const fallbackToIdle = useCallback(() => {
    clearVideoTimers();
    phaseRef.current = 'idle';
    pendingActionRef.current = null;
    busyRef.current = false;
    videoPlayingConfirmedRef.current = false;
    switchIdRef.current++;
    pendingSlotRef.current = null;

    const currentActive = activeSlotRef.current;
    const inactiveSlot = currentActive === 0 ? 1 : 0;
    pendingSlotRef.current = inactiveSlot;

    if (inactiveSlot === 0) {
      setSlotA(prev => ({ source: IDLE_VIDEOS.default, loop: false, key: prev.key + 1 }));
    } else {
      setSlotB(prev => ({ source: IDLE_VIDEOS.default, loop: false, key: prev.key + 1 }));
    }
  }, [clearVideoTimers]);

  const cancelIdlePause = useCallback(() => {
    if (idlePauseTimerRef.current) {
      clearTimeout(idlePauseTimerRef.current);
      idlePauseTimerRef.current = null;
    }
  }, []);

  const startIdle = useCallback(() => {
    cancelIdlePause();
    const pick = pickNextIdle();
    phaseRef.current = 'idle';
    pendingActionRef.current = null;
    busyRef.current = false;

    // Load next idle on inactive slot — it will auto-play and get paused at frame 0
    // via the idlePauseRef flag, then after 1s we resume it.
    clearVideoTimers();
    videoPlayingConfirmedRef.current = false;
    switchIdRef.current++;

    const currentActive = activeSlotRef.current;
    const inactiveSlot = currentActive === 0 ? 1 : 0;
    pendingSlotRef.current = inactiveSlot;
    idlePauseSlotRef.current = inactiveSlot; // tell status handler to pause this

    if (inactiveSlot === 0) {
      setSlotA(prev => ({ source: pick.video, loop: false, key: prev.key + 1 }));
    } else {
      setSlotB(prev => ({ source: pick.video, loop: false, key: prev.key + 1 }));
    }

    // Watchdog in case video never loads
    const newSwitchId = switchIdRef.current;
    watchdogRef.current = setTimeout(() => {
      if (!videoPlayingConfirmedRef.current && switchIdRef.current === newSwitchId) {
        console.warn('Watchdog: idle video did not load within 3s');
        setActiveSlot(inactiveSlot);
        activeSlotRef.current = inactiveSlot;
        pendingSlotRef.current = null;
        idlePauseSlotRef.current = null;
      }
    }, WATCHDOG_TIMEOUT_MS);
  }, [cancelIdlePause, clearVideoTimers]);

  // Greeting on mount: play a random welcome video + greeting audio
  useEffect(() => {
    const playGreeting = async () => {
      try {
        phaseRef.current = 'speaking';
        // Play welcome video once (not looping)
        switchVideo(WELCOME_VIDEOS[Math.floor(Math.random() * WELCOME_VIDEOS.length)], false);

        const entry = GREET_SOUNDS[Math.floor(Math.random() * GREET_SOUNDS.length)];
        const { sound } = await Audio.Sound.createAsync(entry.file);
        soundRef.current = sound;

        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.didJustFinish) {
            sound.setOnPlaybackStatusUpdate(null);
            startIdle();
          }
        });

        await sound.playAsync();
      } catch (e) {
        console.warn('Error playing greeting:', e);
        startIdle();
      }
    };
    playGreeting();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearVideoTimers();
      if (soundRef.current) soundRef.current.unloadAsync();
      if (recordingRef.current) recordingRef.current.stopAndUnloadAsync().catch(() => {});
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    };
  }, [clearVideoTimers]);

  const stopCurrentSound = useCallback(async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch (e) { /* ignore */ }
      soundRef.current = null;
    }
  }, []);

  const playSoundAsync = useCallback(async (source) => {
    await stopCurrentSound();
    const { sound } = await Audio.Sound.createAsync(source);
    soundRef.current = sound;
    await sound.playAsync();
    return sound;
  }, [stopCurrentSound]);

  const onVideoFinish = useCallback(() => {
    const phase = phaseRef.current;

    if (phase === 'idle') {
      startIdle();
      return;
    }

    if (phase === 'action') {
      const action = pendingActionRef.current;
      if (action === 'lookDown') {
        startIdle();
        return;
      }
      if (action === 'lookUp') {
        if (modeRef.current === 'highPitch') {
          // Pin on last frame: seek to end and pause so it never goes blank
          const ref = activeSlotRef.current === 0 ? videoRefA : videoRefB;
          if (ref.current) {
            ref.current.getStatusAsync().then((status) => {
              if (status.isLoaded && status.durationMillis) {
                ref.current.setStatusAsync({
                  positionMillis: status.durationMillis,
                  shouldPlay: false,
                }).catch(() => {});
              }
            }).catch(() => {});
          }
        } else {
          startIdle();
        }
        return;
      }
      return;
    }

    // Speaking phase: if the video finishes (non-looping welcome video) while
    // audio is still playing, switch to a looping speak video for the remainder
    if (phase === 'speaking') {
      switchVideo(pickSpeakVideo(), true);
      return;
    }

    // greatSong, highPitchSpeak: audio callback handles transition
  }, [startIdle, switchVideo]);

  // Status handler — called for BOTH slots, with slotIndex identifying which
  const handleSlotStatus = useCallback((slotIndex, status) => {
    // If this is the pending (inactive) slot and it just started playing, swap it to front
    if (slotIndex === pendingSlotRef.current && status.isLoaded && status.isPlaying) {
      videoPlayingConfirmedRef.current = true;
      pendingSlotRef.current = null;

      // If this is a hold-to-tap: pause snap at first frame instead of letting it play
      if (holdActiveRef.current && slotIndex === holdSlotRef.current) {
        const ref = slotIndex === 0 ? videoRefA : videoRefB;
        if (ref.current) {
          ref.current.setStatusAsync({ positionMillis: 0, shouldPlay: false }).catch(() => {});
        }
        setActiveSlot(slotIndex);
        activeSlotRef.current = slotIndex;
        const oldRef = slotIndex === 0 ? videoRefB : videoRefA;
        if (oldRef.current) oldRef.current.pauseAsync().catch(() => {});
        if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
        if (bufferingTimerRef.current) { clearTimeout(bufferingTimerRef.current); bufferingTimerRef.current = null; }
        return;
      }

      // If this is an idle pause: freeze at first frame, swap to front, then
      // start a 1-second timer before resuming playback
      if (idlePauseSlotRef.current === slotIndex) {
        const ref = slotIndex === 0 ? videoRefA : videoRefB;
        if (ref.current) {
          ref.current.setStatusAsync({ positionMillis: 0, shouldPlay: false }).catch(() => {});
        }
        idlePauseSlotRef.current = null;
        setActiveSlot(slotIndex);
        activeSlotRef.current = slotIndex;
        const oldRef = slotIndex === 0 ? videoRefB : videoRefA;
        if (oldRef.current) oldRef.current.pauseAsync().catch(() => {});
        if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
        if (bufferingTimerRef.current) { clearTimeout(bufferingTimerRef.current); bufferingTimerRef.current = null; }
        // After 1 second, resume playback
        idlePauseTimerRef.current = setTimeout(() => {
          idlePauseTimerRef.current = null;
          if (phaseRef.current === 'idle' && ref.current) {
            ref.current.setStatusAsync({ positionMillis: 0, shouldPlay: true }).catch(() => {});
          }
        }, 1000);
        return;
      }

      // Normal swap: make this slot the active (visible) one
      setActiveSlot(slotIndex);
      activeSlotRef.current = slotIndex;

      // Clear watchdog
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      if (bufferingTimerRef.current) {
        clearTimeout(bufferingTimerRef.current);
        bufferingTimerRef.current = null;
      }

      // Pause the old slot to save resources (it stays showing last frame underneath)
      const oldSlotRef = slotIndex === 0 ? videoRefB : videoRefA;
      if (oldSlotRef.current) {
        oldSlotRef.current.pauseAsync().catch(() => {});
      }
      return;
    }

    // Only process the rest for the ACTIVE slot
    if (slotIndex !== activeSlotRef.current) return;

    // Handle load failure
    if (status.isLoaded === false && status.error) {
      console.warn('Video load error:', status.error);
      fallbackToIdle();
      return;
    }

    // Handle prolonged buffering on active slot
    if (status.isLoaded && status.isBuffering) {
      if (!bufferingTimerRef.current) {
        bufferingTimerRef.current = setTimeout(() => {
          console.warn('Video buffering too long, falling back to idle');
          bufferingTimerRef.current = null;
          fallbackToIdle();
        }, BUFFERING_TIMEOUT_MS);
      }
    } else if (status.isLoaded && !status.isBuffering) {
      if (bufferingTimerRef.current) {
        clearTimeout(bufferingTimerRef.current);
        bufferingTimerRef.current = null;
      }
    }

    // Handle video finished (active slot only)
    if (status.didJustFinish && !status.isLooping) {
      onVideoFinish();
    }
  }, [onVideoFinish, fallbackToIdle]);

  const handleSlotError = useCallback((slotIndex, error) => {
    console.warn(`Video slot ${slotIndex} error:`, error);
    // Only fallback if this is the active or pending slot
    if (slotIndex === activeSlotRef.current || slotIndex === pendingSlotRef.current) {
      fallbackToIdle();
    }
  }, [fallbackToIdle]);

  const startSpeaking = useCallback(async (audioSource, overrideVideo = null) => {
    phaseRef.current = 'speaking';
    switchVideo(overrideVideo || pickSpeakVideo(), true);

    try {
      const sound = await playSoundAsync(audioSource);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          sound.setOnPlaybackStatusUpdate(null);
          startIdle();
        }
      });
    } catch (e) {
      console.warn('Error in speaking sequence:', e);
      startIdle();
    }
  }, [playSoundAsync, startIdle, switchVideo]);

  const startGreatSong = useCallback(async (audioSource) => {
    phaseRef.current = 'greatSong';
    switchVideo(GREAT_SONG_VIDEO, true);

    try {
      const sound = await playSoundAsync(audioSource);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          sound.setOnPlaybackStatusUpdate(null);
          startIdle();
        }
      });
    } catch (e) {
      console.warn('Error in great song sequence:', e);
      startIdle();
    }
  }, [playSoundAsync, startIdle, switchVideo]);

  const playAction = useCallback(async (actionKey, audioSource, isGreatSong, speakOverride = null) => {
    if (busyRef.current) return;
    busyRef.current = true;

    await stopCurrentSound();

    pendingActionRef.current = actionKey;
    phaseRef.current = 'action';
    switchVideo(ACTION_VIDEOS[actionKey], false);

    if (actionKey === 'lookUp' || actionKey === 'lookDown') {
      return;
    }

    // Wait for action video to finish
    const currentSwitchId = switchIdRef.current;
    await new Promise((resolve) => {
      const checkFinish = setInterval(async () => {
        if (switchIdRef.current !== currentSwitchId) {
          clearInterval(checkFinish);
          resolve();
          return;
        }
        const ref = getActiveVideoRef();
        if (ref.current) {
          try {
            const status = await ref.current.getStatusAsync();
            if (status.didJustFinish || (status.durationMillis && status.positionMillis >= status.durationMillis - 100)) {
              clearInterval(checkFinish);
              resolve();
            }
          } catch (e) {
            clearInterval(checkFinish);
            resolve();
          }
        }
      }, 80);
      setTimeout(() => { clearInterval(checkFinish); resolve(); }, 15000);
    });

    if (pendingActionRef.current !== actionKey || switchIdRef.current !== currentSwitchId) return;

    if (isGreatSong) {
      await startGreatSong(audioSource);
    } else {
      await startSpeaking(audioSource, speakOverride);
    }
  }, [stopCurrentSound, startSpeaking, startGreatSong, switchVideo, getActiveVideoRef]);

  // ──── Hold-to-tap system ────
  // Finger down: show snap.mp4 first frame (paused). Hold for ≥500ms.
  // Finger up: if held long enough, play snap animation → speaking.
  // If released too early or turns into a swipe, cancel and revert.

  const handleHoldStart = useCallback(() => {
    if (modeRef.current === 'highPitch') return;
    if (busyRef.current) return;

    holdStartRef.current = Date.now();

    // Load snap.mp4 on the inactive slot, paused at first frame
    clearVideoTimers();
    videoPlayingConfirmedRef.current = false;
    switchIdRef.current++;

    const currentActive = activeSlotRef.current;
    const inactiveSlot = currentActive === 0 ? 1 : 0;
    holdSlotRef.current = inactiveSlot;
    pendingSlotRef.current = inactiveSlot;

    // Load snap paused (shouldPlay is true on the component, but we'll pause
    // immediately once it starts via the status handler)
    if (inactiveSlot === 0) {
      setSlotA(prev => ({ source: ACTION_VIDEOS.snap, loop: false, key: prev.key + 1 }));
    } else {
      setSlotB(prev => ({ source: ACTION_VIDEOS.snap, loop: false, key: prev.key + 1 }));
    }

    holdActiveRef.current = true;
  }, [clearVideoTimers]);

  const handleHoldCancel = useCallback(() => {
    if (!holdActiveRef.current) return;
    const wasSlot = holdSlotRef.current;
    holdActiveRef.current = false;
    holdStartRef.current = null;
    holdSlotRef.current = null;
    pendingSlotRef.current = null;

    // If the snap slot was already swapped to front (user held long enough for
    // the first frame to show), swap back to the other slot which has the
    // previous video frozen on its last frame.
    if (wasSlot !== null && activeSlotRef.current === wasSlot) {
      const otherSlot = wasSlot === 0 ? 1 : 0;
      setActiveSlot(otherSlot);
      activeSlotRef.current = otherSlot;
    }
  }, []);

  const handleHoldRelease = useCallback(async () => {
    if (!holdActiveRef.current) return;
    if (modeRef.current === 'highPitch') {
      handleHoldCancel();
      return;
    }

    const heldMs = Date.now() - (holdStartRef.current || 0);
    holdActiveRef.current = false;
    holdStartRef.current = null;

    if (heldMs < HOLD_MIN_MS) {
      // Held too briefly — cancel
      handleHoldCancel();
      return;
    }

    // Held long enough — resume snap playback on the slot where it's paused
    busyRef.current = true;
    const snapSlot = holdSlotRef.current;
    holdSlotRef.current = null;

    const snapRef = snapSlot === 0 ? videoRefA : videoRefB;

    // Make sure the snap slot is active (on top)
    setActiveSlot(snapSlot);
    activeSlotRef.current = snapSlot;
    pendingSlotRef.current = null;

    // Pause the old slot
    const oldRef = snapSlot === 0 ? videoRefB : videoRefA;
    if (oldRef.current) oldRef.current.pauseAsync().catch(() => {});

    // Seek to start and play
    pendingActionRef.current = 'snap';
    phaseRef.current = 'action';
    if (snapRef.current) {
      try {
        await snapRef.current.setStatusAsync({ positionMillis: 0, shouldPlay: true });
      } catch (e) {
        console.warn('Error resuming snap:', e);
        busyRef.current = false;
        startIdle();
        return;
      }
    }

    // Wait for snap video to finish
    const currentSwitchId = switchIdRef.current;
    await new Promise((resolve) => {
      const checkFinish = setInterval(async () => {
        if (switchIdRef.current !== currentSwitchId) {
          clearInterval(checkFinish);
          resolve();
          return;
        }
        if (snapRef.current) {
          try {
            const status = await snapRef.current.getStatusAsync();
            if (status.didJustFinish || (status.durationMillis && status.positionMillis >= status.durationMillis - 100)) {
              clearInterval(checkFinish);
              resolve();
            }
          } catch (e) {
            clearInterval(checkFinish);
            resolve();
          }
        }
      }, 80);
      setTimeout(() => { clearInterval(checkFinish); resolve(); }, 15000);
    });

    if (pendingActionRef.current !== 'snap' || switchIdRef.current !== currentSwitchId) return;

    // Pick audio
    let audioSource;
    let isGreatSong = false;
    let speakOverride = null;
    if (shouldPlayRare()) {
      const rare = RARE_SOUNDS[Math.floor(Math.random() * RARE_SOUNDS.length)];
      audioSource = rare.file;
      isGreatSong = rare.label === 'GREAT_SONG';
      speakOverride = getSpeakVideoForSound(rare.label);
    } else {
      const entry = TAP_SOUNDS[tapIndexRef.current % TAP_SOUNDS.length];
      tapIndexRef.current++;
      audioSource = entry.file;
      speakOverride = getSpeakVideoForSound(entry.label);
    }

    if (isGreatSong) {
      await startGreatSong(audioSource);
    } else {
      await startSpeaking(audioSource, speakOverride);
    }
  }, [handleHoldCancel, startIdle, startSpeaking, startGreatSong]);

  const handleHorizontalSwipe = useCallback(async (direction) => {
    if (modeRef.current === 'highPitch') return;

    const actionKey = direction === 'left' ? 'leftToRight' : 'rightToLeft';

    if (shouldPlayRare()) {
      const rare = RARE_SOUNDS[Math.floor(Math.random() * RARE_SOUNDS.length)];
      const override = getSpeakVideoForSound(rare.label);
      await playAction(actionKey, rare.file, rare.label === 'GREAT_SONG', override);
      return;
    }

    const entry = SWIPE_SOUNDS[swipeIndexRef.current % SWIPE_SOUNDS.length];
    swipeIndexRef.current++;
    const override = getSpeakVideoForSound(entry.label);
    await playAction(actionKey, entry.file, false, override);
  }, [playAction]);

  // Helper: wait for the currently active video to finish playing
  const waitForActiveVideoEnd = useCallback(async () => {
    const currentSwitchId = switchIdRef.current;
    await new Promise((resolve) => {
      const checkFinish = setInterval(async () => {
        if (switchIdRef.current !== currentSwitchId) {
          clearInterval(checkFinish);
          resolve();
          return;
        }
        const ref = getActiveVideoRef();
        if (ref.current) {
          try {
            const status = await ref.current.getStatusAsync();
            if (status.didJustFinish || (status.durationMillis && status.positionMillis >= status.durationMillis - 100)) {
              clearInterval(checkFinish);
              resolve();
            }
          } catch (e) {
            clearInterval(checkFinish);
            resolve();
          }
        }
      }, 80);
      setTimeout(() => { clearInterval(checkFinish); resolve(); }, 15000);
    });
  }, [getActiveVideoRef]);

  // Play high-pitch recording back with a talk video, then return to idle
  const playHighPitchBack = useCallback(async (uri) => {
    await stopCurrentSound();
    phaseRef.current = 'highPitchSpeak';
    switchVideo(pickSpeakVideo(), true);

    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { rate: 1.5, shouldCorrectPitch: false, volume: 1.0 }
    );
    soundRef.current = sound;

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.didJustFinish) {
        sound.setOnPlaybackStatusUpdate(null);
        startIdle();
      }
    });

    await sound.playAsync();
  }, [stopCurrentSound, startIdle, switchVideo]);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);
      setMode('normal');

      if (uri) {
        // Play look_down animation first, wait for it to finish, then play back
        pendingActionRef.current = 'lookDown';
        phaseRef.current = 'action';
        switchVideo(ACTION_VIDEOS.lookDown, false);

        await waitForActiveVideoEnd();

        await playHighPitchBack(uri);
      } else {
        startIdle();
      }
    } catch (e) {
      console.warn('Error stopping recording:', e);
      setIsRecording(false);
      setMode('normal');
      startIdle();
    }
  }, [switchVideo, waitForActiveVideoEnd, playHighPitchBack, startIdle]);

  const handleSwipeUp = useCallback(async () => {
    if (modeRef.current === 'highPitch') return;

    await stopCurrentSound();
    busyRef.current = false;

    pendingActionRef.current = 'lookUp';
    phaseRef.current = 'action';
    switchVideo(ACTION_VIDEOS.lookUp, false);

    setMode('highPitch');
    setIsRecording(true);

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setMode('normal');
        setIsRecording(false);
        startIdle();
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      await recording.startAsync();
      recordingRef.current = recording;

      recordingTimerRef.current = setTimeout(async () => {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        stopRecording();
      }, RECORDING_DURATION_MS);
    } catch (e) {
      console.warn('Error starting recording:', e);
      setMode('normal');
      setIsRecording(false);
      startIdle();
    }
  }, [stopRecording, stopCurrentSound, startIdle, switchVideo]);

  const handleSwipeDown = useCallback(async () => {
    if (modeRef.current !== 'highPitch') return;

    // Cancel the auto-stop timer so stopRecording doesn't also fire
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    // Stop recording and get the URI (while look_down will play visually)
    let uri = null;
    if (recordingRef.current) {
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        await recordingRef.current.stopAndUnloadAsync();
        uri = recordingRef.current.getURI();
        recordingRef.current = null;
      } catch (e) {
        console.warn('Error stopping recording in swipe down:', e);
        recordingRef.current = null;
      }
    }
    setIsRecording(false);
    setMode('normal');

    // Play look_down animation and wait for it to finish
    pendingActionRef.current = 'lookDown';
    phaseRef.current = 'action';
    switchVideo(ACTION_VIDEOS.lookDown, false);
    await waitForActiveVideoEnd();

    // Then play high-pitch recording with talk video, or just go to idle
    if (uri) {
      try {
        await playHighPitchBack(uri);
      } catch (e) {
        console.warn('Error playing back recording:', e);
        startIdle();
      }
    } else {
      startIdle();
    }
  }, [switchVideo, waitForActiveVideoEnd, playHighPitchBack, startIdle]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // Finger down: start hold (show snap first frame)
        handleHoldStart();
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const { dx, dy } = gestureState;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        if (absDy > VERTICAL_THRESHOLD && dy < 0) {
          handleHoldCancel(); // was a swipe, not a hold
          handleSwipeUp();
        } else if (absDy > VERTICAL_THRESHOLD && dy > 0) {
          handleHoldCancel();
          handleSwipeDown();
        } else if (absDx > HORIZONTAL_THRESHOLD && absDx > absDy) {
          handleHoldCancel();
          handleHorizontalSwipe(dx > 0 ? 'left' : 'right');
        } else {
          // Small movement = hold release (tap)
          handleHoldRelease();
        }
      },
      onPanResponderTerminate: () => {
        // Touch was stolen (e.g. by system gesture) — cancel hold
        handleHoldCancel();
      },
    })
  ).current;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <StatusBar style="light" />

      {/* Double-buffered video: both always mounted, active slot on top via zIndex */}
      <Video
        key={`a-${slotA.key}`}
        ref={videoRefA}
        source={slotA.source}
        style={[styles.video, { zIndex: activeSlot === 0 ? 2 : 1 }]}
        resizeMode={ResizeMode.COVER}
        shouldPlay={true}
        isLooping={slotA.loop}
        onPlaybackStatusUpdate={(status) => handleSlotStatus(0, status)}
        onError={(error) => handleSlotError(0, error)}
        isMuted={true}
      />
      <Video
        key={`b-${slotB.key}`}
        ref={videoRefB}
        source={slotB.source}
        style={[styles.video, { zIndex: activeSlot === 1 ? 2 : 1 }]}
        resizeMode={ResizeMode.COVER}
        shouldPlay={true}
        isLooping={slotB.loop}
        onPlaybackStatusUpdate={(status) => handleSlotStatus(1, status)}
        onError={(error) => handleSlotError(1, error)}
        isMuted={true}
      />

      {isRecording && (
        <View style={styles.recordingIndicator}>
          <Text style={styles.recordingText}>מקשיב...</Text>
          <Text style={styles.recordingSubtext}>החלק למטה כדי לצאת</Text>
        </View>
      )}

      <View style={styles.hintContainer}>
        <Text style={styles.hintText}>
          {mode === 'normal'
            ? 'לחץ • החלק הצידה • החלק למעלה למיקרופון'
            : 'החלק למטה לצאת ממצב מיקרופון'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  recordingIndicator: {
    position: 'absolute',
    bottom: 140,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 50, 50, 0.85)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: 'center',
    zIndex: 10,
  },
  recordingText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  recordingSubtext: {
    color: '#ffcccc',
    fontSize: 13,
    marginTop: 4,
  },
  hintContainer: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    zIndex: 10,
  },
  hintText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
