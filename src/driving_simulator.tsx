import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
// Let TypeScript know Qualtrics exists globally
declare const Qualtrics: any;

const AUTOPILOT_BLIND_DISTANCE = 1000; // Units before the finish where autopilot goes blind
const TRACK_LENGTH = 6500; // Total distance from start to finish line in world units
const AUTOPILOT_SPEED_UNITS = 1.6; // carVelocity units corresponding to autopilot max speed
const AUTOPILOT_MAX_MPH = 120;
const MANUAL_MAX_MPH = 75;
const CAR_UNITS_TO_MPH = AUTOPILOT_MAX_MPH / AUTOPILOT_SPEED_UNITS;
const MANUAL_MAX_VELOCITY = MANUAL_MAX_MPH / CAR_UNITS_TO_MPH;
const labelCondition = 'Copilot';

// Notification timing (in seconds) - configurable
const NOTIFICATION_1_TIME = 9;  // First notification at 8 seconds
const NOTIFICATION_2_TIME = 18; // Second notification at 14 seconds
const NOTIFICATION_3_TIME = 27; // Third notification at 20 seconds
const NOTIFICATION_4_TIME = 36; // Fourth notification at 26 seconds
const NOTIFICATION_5_TIME = 45; // Fifth notification at 32 seconds
const NOTIFICATION_DURATION = 5; // How long each notification stays visible (seconds)

interface ModeBySecond {
  second: number;
  mode: string;
}

interface SimulationData {
  modeBySecond: ModeBySecond[];
  whiteBlocksHit: number;
  failureLaneHits: number;
  modeByUnit: string[];
  collisionEvents: CollisionEvent[];
  finalScore: number;
  notifications: Notification[];
  notificationsSeen: number; // Count of notifications that were opened/seen
  notificationsTotal: number; // Total notifications received
  finishLineCrossSecond: number | null; // Time at which finish line was crossed (in seconds, 3 decimal places)
}

interface AutopilotDecision {
  accelerate: boolean;
  lane: number;
  targetSpeed: number;
}

interface Keys {
  ArrowUp: boolean;
  ArrowDown: boolean;
  ArrowLeft: boolean;
  ArrowRight: boolean;
  [key: string]: boolean;
}

interface CollisionEvent {
  unit: number;
  mode: string;
  lane: number;
  z: number;
  type: 'traffic' | 'block';
  isBlindLane?: boolean;
}

interface Notification {
  id: number;
  type: 'text' | 'news' | 'social' | 'music';
  title: string;
  content: string;
  icon?: string;
  timestamp: number;
  seen: boolean;
  arrivalSecond: number | null; // Time at which notification arrived (in seconds, 3 decimal places)
  clickedSecond: number | null; // Time at which notification was clicked (in seconds, 3 decimal places)
  reactionTime: number | null; // Difference between clicked and arrival (in seconds, 3 decimal places)
  openSessions: Array<{ openTime: number; closeTime: number | null; mode: string }>; // Track each time notification is opened/closed (in seconds, 3 decimal places), with mode at open time
  totalOpenDuration: number; // Total seconds notification has been open (sum of all closed sessions, 3 decimal places)
}

const DrivingSimulator = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [isAutopilot, setIsAutopilot] = useState(true);
  const [autopilotPending, setAutopilotPending] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [score, setScore] = useState(1000);
  const [scoreFlash, setScoreFlash] = useState(false);
  const [showInstructions, setShowInstructions] = useState(true);
  const [gameStarted, setGameStarted] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [speed, setSpeed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notificationsRef = useRef<Notification[]>([]);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [showNewNotificationPopup, setShowNewNotificationPopup] = useState(false);
  const [showViewAllNotificationsPopup, setShowViewAllNotificationsPopup] = useState(false);
  const isCompleteRef = useRef(false);
  const gameStartedRef = useRef(false);
  const startTimeRef = useRef<number | null>(null);
  const autopilotRef = useRef(false);
  const autopilotPendingRef = useRef(false);
  const progressRef = useRef(0);
  const scoreRef = useRef(1000);
  const failureLaneHitsRef = useRef(0);
  const lastDistanceUnitLoggedRef = useRef(-1);
  const blindLaneStateRef = useRef<{ index: number | null; prepopulated: boolean }>({
    index: null,
    prepopulated: false
  });
  const flashTimeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const lastTabHiddenTimeRef = useRef<number | null>(null); // Track when tab was hidden
  const simulationDataRef = useRef<SimulationData>({
    modeBySecond: [], // Track mode at each second
    whiteBlocksHit: 0, // Count white block collisions
    failureLaneHits: 0,
    modeByUnit: [],
    collisionEvents: [],
    finalScore: 0,
    notifications: [],
    notificationsSeen: 0,
    notificationsTotal: 0,
    finishLineCrossSecond: null
  });

  const startGame = () => {
    setShowInstructions(false);
    setCountdown(3);
    setIsAutopilot(true);
    autopilotRef.current = true;
    autopilotPendingRef.current = false;
    setAutopilotPending(false);
    progressRef.current = 0;
    setProgress(0);
    setElapsedTime(0);
    setNotifications([]);
    notificationsRef.current = [];
    setSelectedNotification(null);
    setShowNewNotificationPopup(false);
    setShowViewAllNotificationsPopup(false);
    failureLaneHitsRef.current = 0;
    lastDistanceUnitLoggedRef.current = -1;
    blindLaneStateRef.current = { index: null, prepopulated: false };
    simulationDataRef.current = {
      modeBySecond: [],
      whiteBlocksHit: 0,
      failureLaneHits: 0,
      modeByUnit: [],
      collisionEvents: [],
      finalScore: 0,
      notifications: [],
      notificationsSeen: 0,
      notificationsTotal: 0,
      finishLineCrossSecond: null
    };
    
    // Start countdown
    let count = 3;
    countdownIntervalRef.current = window.setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
      } else if (count === 0) {
        setCountdown(0); // Show "GO!"
        setTimeout(() => {
          setCountdown(null);
          gameStartedRef.current = true;
          setGameStarted(true);
          startTimeRef.current = Date.now();
          scoreRef.current = 1000;
          setScore(1000);
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
          }
        }, 500);
      }
    }, 1000);
  };

  const handleToggleAutopilot = () => {
    if (isAutopilot || autopilotPendingRef.current) {
      setIsAutopilot(false);
      autopilotRef.current = false;
      autopilotPendingRef.current = false;
      setAutopilotPending(false);
    } else {
      autopilotPendingRef.current = true;
      setAutopilotPending(true);
    }
  };

  const blindProgressThreshold = 1 - (AUTOPILOT_BLIND_DISTANCE / TRACK_LENGTH);
  const inBlindZone = progress >= blindProgressThreshold;

  useEffect(() => {
    autopilotRef.current = isAutopilot;
  }, [isAutopilot]);

  // Keep notifications ref in sync with state
  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  // Track notification open/close times
  useEffect(() => {
    if (selectedNotification && gameStartedRef.current && startTimeRef.current) {
      // Notification opened - record open time (with 3 decimal places) and current mode
      const currentTime = parseFloat(((Date.now() - startTimeRef.current) / 1000).toFixed(3));
      const currentMode = autopilotRef.current ? labelCondition.toLowerCase() : 'manual';
      setNotifications(prev => {
        const updated = prev.map(n => {
          if (n.id === selectedNotification.id) {
            // Check if there's an open session without a close time
            const hasOpenSession = n.openSessions.length > 0 && 
              n.openSessions[n.openSessions.length - 1].closeTime === null;
            
            if (!hasOpenSession) {
              // Start new open session with current mode
              return {
                ...n,
                openSessions: [...n.openSessions, { openTime: currentTime, closeTime: null, mode: currentMode }]
              };
            }
          }
          return n;
        });
        notificationsRef.current = updated;
        return updated;
      });
    } else if (!selectedNotification) {
      // Notification closed - find any open session and close it
      setNotifications(prev => {
        const updated = prev.map(n => {
          // Check if this notification has an open session
          if (n.openSessions.length > 0) {
            const lastSession = n.openSessions[n.openSessions.length - 1];
            if (lastSession.closeTime === null && gameStartedRef.current && startTimeRef.current) {
              const currentTime = parseFloat(((Date.now() - startTimeRef.current) / 1000).toFixed(3));
              const sessionDuration = parseFloat((currentTime - lastSession.openTime).toFixed(3));
              const updatedSessions = [...n.openSessions];
              updatedSessions[updatedSessions.length - 1] = {
                ...lastSession,
                closeTime: currentTime
              };
              return {
                ...n,
                openSessions: updatedSessions,
                totalOpenDuration: n.totalOpenDuration + sessionDuration
              };
            }
          }
          return n;
        });
        notificationsRef.current = updated;
        return updated;
      });
    }
  }, [selectedNotification]);

  // Calculate scale to fit the simulator in available space
  useEffect(() => {
    const calculateScale = () => {
      if (!wrapperRef.current) return;
      const wrapper = wrapperRef.current;
      const availableWidth = wrapper.clientWidth;
      const availableHeight = wrapper.clientHeight;
      
      // Base dimensions (what we designed for) - reduced to fit viewport without scrolling
      const baseWidth = 1067;
      const baseHeight = 600;
      
      // Calculate scale to fit - allow scaling up to fill space (with small margin)
      const scaleX = (availableWidth * 0.98) / baseWidth;  // 2% margin
      const scaleY = (availableHeight * 0.98) / baseHeight; // 2% margin
      const newScale = Math.min(scaleX, scaleY); // Scale to fit, no cap
      
      setScale(newScale);
    };

    calculateScale();
    window.addEventListener('resize', calculateScale);
    return () => window.removeEventListener('resize', calculateScale);
  }, []);

  useEffect(() => {
    isCompleteRef.current = isComplete;
  }, [isComplete]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.offsetWidth;
    const height = container.offsetHeight;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 50, 200);

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
    sunLight.position.set(50, 100, 50);
    sunLight.castShadow = true;
    scene.add(sunLight);

    // Define lanes first
    const lanes = [-2, 0, 2];

    // Car setup
    const carGroup = new THREE.Group();
    const carBody = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1, 4),
      new THREE.MeshStandardMaterial({ color: 0xe48bff, metalness: 0.6, roughness: 0.35 })
    );
    carBody.position.y = 0.5;
    carBody.castShadow = true;
    carGroup.add(carBody);

    const carTop = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.8, 2),
      new THREE.MeshStandardMaterial({ color: 0xf2c6ff, metalness: 0.5, roughness: 0.4 })
    );
    carTop.position.set(0, 1.3, -0.3);
    carTop.castShadow = true;
    carGroup.add(carTop);

    // Wheels
    const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const wheelPositions: [number, number, number][] = [
      [-1, 0.4, 1.3], [1, 0.4, 1.3],
      [-1, 0.4, -1.3], [1, 0.4, -1.3]
    ];
    
    wheelPositions.forEach(pos => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(pos[0], pos[1], pos[2]);
      wheel.castShadow = true;
      carGroup.add(wheel);
    });

    carGroup.position.set(0, 0, 0);
    scene.add(carGroup);

    camera.position.set(0, 3, 8);
    camera.lookAt(carGroup.position);

    // Road
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const roadSegments: THREE.Mesh[] = [];
    
    for (let i = -10; i < 50; i++) {
      const road = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 20),
        roadMaterial
      );
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, 0, i * 20);
      road.receiveShadow = true;
      scene.add(road);
      roadSegments.push(road);

      for (let j = 0; j < 4; j++) {
        const marking = new THREE.Mesh(
          new THREE.PlaneGeometry(0.3, 2),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        marking.rotation.x = -Math.PI / 2;
        marking.position.set(0, 0.02, i * 20 + j * 5);
        scene.add(marking);
      }

      [-6, 6].forEach(x => {
        const sidewalk = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 20),
          new THREE.MeshStandardMaterial({ color: 0x999999 })
        );
        sidewalk.rotation.x = -Math.PI / 2;
        sidewalk.position.set(x, 0.01, i * 20);
        sidewalk.receiveShadow = true;
        scene.add(sidewalk);
      });
    }

    // Buildings
    for (let i = -5; i < 40; i += 3) {
      [-15, 15].forEach(x => {
        const height = 10 + Math.random() * 20;
        const building = new THREE.Mesh(
          new THREE.BoxGeometry(8, height, 8),
          new THREE.MeshStandardMaterial({ 
            color: new THREE.Color().setHSL(0.1, 0.2, 0.3 + Math.random() * 0.3),
            metalness: 0.3,
            roughness: 0.7
          })
        );
        building.position.set(x, height / 2, i * 20);
        building.castShadow = true;
        building.receiveShadow = true;
        scene.add(building);

        for (let floor = 0; floor < height / 3; floor++) {
          for (let w = 0; w < 3; w++) {
            const window = new THREE.Mesh(
              new THREE.PlaneGeometry(1, 1.5),
              new THREE.MeshBasicMaterial({ 
                color: Math.random() > 0.3 ? 0xffffaa : 0x222222 
              })
            );
            window.position.set(
              x + (x > 0 ? -4.01 : 4.01),
              2 + floor * 3,
              i * 20 - 3 + w * 2.5
            );
            window.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
            scene.add(window);
          }
        }
      });
    }

    // Traffic - white blocks (minimal and very far apart)
    const otherCars: THREE.Mesh[] = [];
    const trafficPatterns = [
      { lane: 0, z: -400 },
      { lane: 2, z: -1200 },
    ];
    
    trafficPatterns.forEach(pattern => {
      const otherCar = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 4),
        new THREE.MeshStandardMaterial({ 
          color: 0xffffff,
          metalness: 0.5,
          roughness: 0.5,
          emissive: 0xffffff,
          emissiveIntensity: 0.3
        })
      );
      otherCar.position.set(lanes[pattern.lane], 1, pattern.z);
      otherCar.castShadow = true;
      otherCar.userData.isRegularTraffic = true;
      scene.add(otherCar);
      otherCars.push(otherCar);
    });

    // White blocks - spawn throughout the game (deterministic)
    const finalBlocks: THREE.Mesh[] = [];
    const baseBlockSpawnDistance = 140; // Units travelled between regular spawns early in the race
    const lateBlockSpawnDistance = 70;   // Units between late-race spawns as density rises
    const finishBurstSpawnDistance = 140; // Units between finish-line bursts (same as base spawn distance)
    let lastBlockSpawnZ = carGroup.position.z;
    let lastLateBlockSpawnZ = carGroup.position.z;
    let lastFinishBurstSpawnZ = carGroup.position.z;
    let blockSpawnCount = 0; // Track spawn count for deterministic pattern

    // Finish line (static)
    const finishLineZ = -TRACK_LENGTH;
    const finishLine = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 2),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    finishLine.rotation.x = -Math.PI / 2;
    finishLine.position.set(0, 0.03, finishLineZ);
    scene.add(finishLine);

    // Game state
    let carVelocity = 0;
    let carLaneOffset = 0;
    let targetLane = 0;
    let currentLaneIndex = 1;
    const collisionCooldown = new Map();
    const blockFlashTimeouts = new Map<THREE.Mesh, number>();
    let wasAutopilot = false; // Track previous autopilot state
    let finishLineCrossed = false;
    let finishLineCrossTime: number | null = null;
    
    const keys: Keys = {
      ArrowUp: false,
      ArrowDown: false,
      ArrowLeft: false,
      ArrowRight: false
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      if (key in keys) {
        keys[key] = true;
        e.preventDefault(); // Prevent default browser behavior (scrolling)
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key;
      if (key in keys) {
        keys[key] = false;
        e.preventDefault(); // Prevent default browser behavior
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Timer - only start when game begins
    let lastScoreDeduction = 0;
    let lastSecondLogged = -1;
    
    const ensureModeByUnitComplete = () => {
      if (lastDistanceUnitLoggedRef.current >= TRACK_LENGTH) return;
      const modeLabel = autopilotRef.current ? labelCondition.toLowerCase() : 'manual';
      for (let unit = lastDistanceUnitLoggedRef.current + 1; unit <= TRACK_LENGTH; unit++) {
        simulationDataRef.current.modeByUnit[unit] = modeLabel;
      }
      lastDistanceUnitLoggedRef.current = TRACK_LENGTH;
    };
    
    // Track which notifications have been shown
    const notificationsShown = new Set<number>();
    const notificationStartTimes = new Map<number, number>();
    
    // Randomize notification order - create shuffled array of notification IDs
    const notificationIds = [1, 2, 3, 4, 5];
    const shuffledIds = [...notificationIds].sort(() => Math.random() - 0.5);
    
    // Handle tab visibility changes to prevent score pausing
    // Note: We update lastScoreDeduction in the visibility handler to prevent double-deduction
    // The interval's score deduction will handle catching up properly
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab just became hidden - record the time
        lastTabHiddenTimeRef.current = Date.now();
      } else if (lastTabHiddenTimeRef.current && startTimeRef.current) {
        // Tab just became visible - the interval will catch up on score deduction
        // We just need to reset the tracking
        lastTabHiddenTimeRef.current = null;
      }
    };
    
    // Add visibility change listener
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    const timerInterval = setInterval(() => {
      if (!startTimeRef.current || !gameStartedRef.current || isCompleteRef.current) return;
      
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedTime(elapsed);
      
      // Check for notification triggers
      const notificationTimes = [NOTIFICATION_1_TIME, NOTIFICATION_2_TIME, NOTIFICATION_3_TIME, NOTIFICATION_4_TIME, NOTIFICATION_5_TIME];
      notificationTimes.forEach((notifTime, index) => {
        if (elapsed === notifTime && !notificationsShown.has(index)) {
          notificationsShown.add(index);
          const notifId = shuffledIds[index]; // Use randomized ID order
          
          let notification: Notification;
          const arrivalSecond = startTimeRef.current ? parseFloat(((Date.now() - startTimeRef.current) / 1000).toFixed(3)) : null; // Current elapsed time when notification arrives (3 decimal places)
          
          if (notifId === 1) {
            // Text message from John
            notification = {
              id: notifId,
              type: 'text',
              title: 'John',
              content: 'Hey! Do you want anything from the store? I\'m heading there in a bit. Also, did you see that new restaurant that opened downtown? We should check it out sometime!',
              icon: '💬',
              timestamp: Date.now(),
              seen: false,
              arrivalSecond: arrivalSecond,
              clickedSecond: null,
              reactionTime: null,
              openSessions: [],
              totalOpenDuration: 0
            };
          } else if (notifId === 2) {
            // Breaking News
            notification = {
              id: notifId,
              type: 'news',
              title: 'Breaking News',
              content: 'Tech stocks surge as AI adoption accelerates across industries. Major tech companies report record earnings from their AI-related products this quarter!',
              icon: '📰',
              timestamp: Date.now(),
              seen: false,
              arrivalSecond: arrivalSecond,
              clickedSecond: null,
              reactionTime: null,
              openSessions: [],
              totalOpenDuration: 0
            };
          } else if (notifId === 3) {
            // Instagram Social Media
            notification = {
              id: notifId,
              type: 'social',
              title: 'Instagram',
              content: 'You have 5 new posts from people you follow. There are new stories from 3 accounts you follow. Don\'t miss out on these!',
              icon: '📸',
              timestamp: Date.now(),
              seen: false,
              arrivalSecond: arrivalSecond,
              clickedSecond: null,
              reactionTime: null,
              openSessions: [],
              totalOpenDuration: 0
            };
          } else if (notifId === 4) {
            // Text message from Sarah
            notification = {
              id: notifId,
              type: 'text',
              title: 'Sarah',
              content: 'Are we still on for dinner tonight? Let me know! I was thinking we could try that Italian place you mentioned last week.',
              icon: '💬',
              timestamp: Date.now(),
              seen: false,
              arrivalSecond: arrivalSecond,
              clickedSecond: null,
              reactionTime: null,
              openSessions: [],
              totalOpenDuration: 0
            };
          } else {
            // Music App
            notification = {
              id: notifId,
              type: 'music',
              title: 'Spotify',
              content: 'Your Discover Weekly playlist is ready! We\'ve curated 30 new songs from artists you might love.',
              icon: '🎵',
              timestamp: Date.now(),
              seen: false,
              arrivalSecond: arrivalSecond,
              clickedSecond: null,
              reactionTime: null,
              openSessions: [],
              totalOpenDuration: 0
            };
          }
          
          // Add notification to array
          setNotifications(prev => {
            const updated = [...prev, notification];
            notificationsRef.current = updated; // Keep ref in sync
            return updated;
          });
          notificationStartTimes.set(notifId, Date.now());
          
          // Show "new notification" popup
          setShowNewNotificationPopup(true);
          setTimeout(() => {
            setShowNewNotificationPopup(false);
          }, 2000); // Show for 2 seconds
        }
      });
      
      // Log mode at each second
      if (elapsed !== lastSecondLogged) {
        simulationDataRef.current.modeBySecond.push({
          second: elapsed,
          mode: autopilotRef.current ? labelCondition.toLowerCase() : 'manual'
        });
        lastSecondLogged = elapsed;
      }
      
      // Time-based score deduction: -5 points per second
      const now = Date.now();
      if (lastScoreDeduction === 0) {
        lastScoreDeduction = now;
      }
      if (now - lastScoreDeduction >= 1000) {
        scoreRef.current = Math.max(0, scoreRef.current - 5);
        setScore(scoreRef.current);
        lastScoreDeduction = now;
      }
      
      // Completion is now handled by finish line crossing in animation loop
    }, 100);

    const handleResize = () => {
      if (!container) return;
      const width = container.offsetWidth;
      const height = container.offsetHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);
 
     // Animation - Fixed timestep for determinism
     let autopilotTimer = 0;
     let autopilotDecision: AutopilotDecision = { accelerate: true, lane: 1, targetSpeed: 1.3 };
     let animationId: number | undefined;
     let frameCount = 0;
     const FIXED_FPS = 60;
     const FIXED_DELTA = 1 / FIXED_FPS; // Fixed timestep: 1/60 seconds
     let accumulatedTime = 0;
     let lastAnimationTime: number | null = null;

    const animate = () => {
      animationId = requestAnimationFrame(animate);

      const now = performance.now();
      if (lastAnimationTime === null) {
        lastAnimationTime = now;
        renderer.render(scene, camera);
        return;
      }
      
      const realDeltaMs = now - lastAnimationTime;
      lastAnimationTime = now;
      accumulatedTime += realDeltaMs / 1000; // Convert to seconds

      // Process fixed timesteps
      while (accumulatedTime >= FIXED_DELTA) {
        const deltaFactor = 1.0; // Always 1.0 for fixed timestep
        const scaledDelta = FIXED_DELTA; // Use fixed delta for per-second calculations
        frameCount += 1;

      // Only allow car movement after game starts (after countdown)
      const elapsed = startTimeRef.current && gameStartedRef.current 
        ? Math.floor((Date.now() - startTimeRef.current) / 1000) 
        : -1;
      
      // Prevent car movement until game starts
      if (!gameStartedRef.current) {
        carVelocity = 0;
        accumulatedTime -= FIXED_DELTA;
        continue; // Skip this iteration but continue the loop
      }
      
      if (finishLineCrossed && finalBlocks.length > 0) {
        finalBlocks.forEach(block => {
          // Clean up flash timeout if exists
          if (blockFlashTimeouts.has(block)) {
            clearTimeout(blockFlashTimeouts.get(block)!);
            blockFlashTimeouts.delete(block);
          }
          scene.remove(block);
        });
        finalBlocks.length = 0;

        // Capture notification data at finish (this runs in animation loop, so we use ref)
        // Note: This is a fallback - main capture happens at finish line crossing
        if (simulationDataRef.current.notificationsTotal === 0) {
          // Only update if not already captured (to avoid overwriting)
          const currentNotifications = notificationsRef.current;
          simulationDataRef.current.notifications = currentNotifications;
          simulationDataRef.current.notificationsTotal = currentNotifications.length;
          simulationDataRef.current.notificationsSeen = currentNotifications.filter(n => n.seen).length;
        }

        // Log final data to console
        console.log('=== SIMULATION DATA ===');
        console.log('Mode by second:', simulationDataRef.current.modeBySecond);
        console.log('White blocks hit:', simulationDataRef.current.whiteBlocksHit);
        console.log('Failure-lane hits:', simulationDataRef.current.failureLaneHits);
        console.log('Mode by unit length:', simulationDataRef.current.modeByUnit.length);
        console.log('Collision events:', simulationDataRef.current.collisionEvents.length);
        console.log('Final score:', simulationDataRef.current.finalScore);
        console.log('Notifications total:', simulationDataRef.current.notificationsTotal);
        console.log('Notifications seen:', simulationDataRef.current.notificationsSeen);
        console.log('Notifications:', simulationDataRef.current.notifications);
        console.log('======================');

        // Save data to Qualtrics if available
        if (typeof Qualtrics !== 'undefined') {
          Qualtrics.SurveyEngine.setEmbeddedData('sim_mode_by_second', JSON.stringify(simulationDataRef.current.modeBySecond));
          Qualtrics.SurveyEngine.setEmbeddedData('sim_white_blocks_hit', simulationDataRef.current.whiteBlocksHit);
          Qualtrics.SurveyEngine.setEmbeddedData('sim_failure_lane_hits', simulationDataRef.current.failureLaneHits);
          Qualtrics.SurveyEngine.setEmbeddedData('sim_mode_by_unit', JSON.stringify(simulationDataRef.current.modeByUnit));
          Qualtrics.SurveyEngine.setEmbeddedData('sim_collision_events', JSON.stringify(simulationDataRef.current.collisionEvents));
          Qualtrics.SurveyEngine.setEmbeddedData('sim_final_score', simulationDataRef.current.finalScore);
            Qualtrics.SurveyEngine.setEmbeddedData('sim_finish_line_cross_second', simulationDataRef.current.finishLineCrossSecond !== null ? simulationDataRef.current.finishLineCrossSecond : '');
            Qualtrics.SurveyEngine.setEmbeddedData('sim_notifications', JSON.stringify(simulationDataRef.current.notifications));
            Qualtrics.SurveyEngine.setEmbeddedData('sim_notifications_total', simulationDataRef.current.notificationsTotal);
            Qualtrics.SurveyEngine.setEmbeddedData('sim_notifications_seen', simulationDataRef.current.notificationsSeen);
            // Export notification open duration data
            const notificationsWithDuration = simulationDataRef.current.notifications.map((n: Notification) => ({
              id: n.id,
              totalOpenDuration: n.totalOpenDuration,
              openSessions: n.openSessions
            }));
            Qualtrics.SurveyEngine.setEmbeddedData('sim_notifications_open_duration', JSON.stringify(notificationsWithDuration));
          console.log('Data saved to Qualtrics embedded data');
        }
      }

      const distanceTravelled = Math.abs(carGroup.position.z);
      const trackLength = TRACK_LENGTH;
      const progressRatio = Math.min(distanceTravelled / trackLength, 1);
      // Density level calculation (kept for scaffolding - can be used to vary density later)
      // To enable variable density, uncomment the densityLevel usage in interval calculations below
      const densityLevel = Math.min(Math.floor(progressRatio * 10), 10);
      const distanceToFinish = carGroup.position.z - finishLineZ;

      if (Math.abs(progressRatio - progressRef.current) > 0.005) {
        progressRef.current = progressRatio;
        setProgress(progressRatio);
      }

      const currentDistanceUnit = Math.min(Math.floor(distanceTravelled), TRACK_LENGTH);
      if (currentDistanceUnit > lastDistanceUnitLoggedRef.current && currentDistanceUnit >= 0) {
        const modeLabel = autopilotRef.current ? labelCondition.toLowerCase() : 'manual';
        for (let unit = lastDistanceUnitLoggedRef.current + 1; unit <= currentDistanceUnit; unit++) {
          simulationDataRef.current.modeByUnit[unit] = modeLabel;
        }
        lastDistanceUnitLoggedRef.current = currentDistanceUnit;
      }

      // Blind zone logic removed - finish line removed
      // if (!finishLineCrossed && distanceToFinish > 0 && distanceToFinish <= AUTOPILOT_BLIND_DISTANCE && elapsed >= 0) {
      //   ... (blind zone block spawning logic)
      // }

      // Block spawning - using finish line logic from original
      if (!finishLineCrossed && elapsed >= 0) {
        if (distanceToFinish > AUTOPILOT_BLIND_DISTANCE) {
        const distanceSinceLastSpawn = Math.abs(carGroup.position.z - lastBlockSpawnZ);
          // Constant density: use baseBlockSpawnDistance for consistent spacing
          // To enable variable density: use: Math.max(55, baseBlockSpawnDistance - densityLevel * 7)
          const dynamicInterval = baseBlockSpawnDistance;
          if (distanceTravelled > 80 && distanceSinceLastSpawn >= dynamicInterval) {
          lastBlockSpawnZ = carGroup.position.z;
            const spawnDistance = 80;
          
            // Deterministic lane pattern: cycle through lanes [0, 2, 1, 0, 2, 1, ...]
            const lanePattern = [0, 2, 1];
          const laneIndex = lanePattern[blockSpawnCount % lanePattern.length];
          
            // Deterministic offset pattern: cycle through offsets
            const offsetPattern = [3, 5, 4, 6, 3.5, 5.5];
          const offset = offsetPattern[blockSpawnCount % offsetPattern.length];
          
          const block = new THREE.Mesh(
            new THREE.BoxGeometry(2, 2, 4),
            new THREE.MeshStandardMaterial({ 
              color: 0xffffff,
              metalness: 0.5,
              roughness: 0.5,
              emissive: 0xffffff,
              emissiveIntensity: 0.3
            })
          );
          block.position.set(lanes[laneIndex], 1, carGroup.position.z - spawnDistance - offset);
          block.castShadow = true;
          block.userData.isFinalBlock = true;
          scene.add(block);
          finalBlocks.push(block);
          
            blockSpawnCount++;
          }
        }

        if (distanceToFinish <= AUTOPILOT_BLIND_DISTANCE && distanceToFinish > 300) {
          const distanceSinceLastLateSpawn = Math.abs(carGroup.position.z - lastLateBlockSpawnZ);
          // Constant density: use baseBlockSpawnDistance for consistent spacing (same as early section)
          // To enable variable density: use: Math.max(35, lateBlockSpawnDistance - densityLevel * 4)
          const dynamicLateInterval = baseBlockSpawnDistance;
          if (distanceSinceLastLateSpawn >= dynamicLateInterval) {
            lastLateBlockSpawnZ = carGroup.position.z;
            const spawnDistance = 70;
            // Don't spawn in blind lane (commented out blind lane logic)
            const possibleLanes = [0, 1, 2];

            if (possibleLanes.length > 0) {
              // Deterministic: cycle through lanes based on spawn count
              const laneIndex = blockSpawnCount % possibleLanes.length;
              const selectedLane = possibleLanes[laneIndex];
              
              // Deterministic offset pattern
              const offsetPattern = [3.5, 5, 4.5, 6, 4, 5.5];
              const offset = offsetPattern[blockSpawnCount % offsetPattern.length];
              
              const block = new THREE.Mesh(
                new THREE.BoxGeometry(2, 2, 4),
                new THREE.MeshStandardMaterial({ 
                  color: 0xffffff,
                  metalness: 0.5,
                  roughness: 0.5,
                  emissive: 0xffffff,
                  emissiveIntensity: 0.35
                })
              );
              block.position.set(selectedLane, 1, carGroup.position.z - spawnDistance - offset);
              block.castShadow = true;
              block.userData.isFinalBlock = true;
              scene.add(block);
              finalBlocks.push(block);
              
              blockSpawnCount++;
            }
          }
        }
      }

      if (!finishLineCrossed && distanceToFinish > 0 && distanceToFinish < 300 && elapsed >= 0) {
        const distanceSinceLastBurst = Math.abs(carGroup.position.z - lastFinishBurstSpawnZ);
        // Constant density: use baseBlockSpawnDistance for consistent spacing (same as all sections)
        // To enable variable density: use: Math.max(55, finishBurstSpawnDistance - densityLevel * 7)
        const dynamicBurstInterval = baseBlockSpawnDistance;
        if (distanceSinceLastBurst >= dynamicBurstInterval) {
          lastFinishBurstSpawnZ = carGroup.position.z;
          const spawnDistance = 80; // Same as middle section

          // Don't spawn in blind lane (commented out blind lane logic)
          const availableLanes = [0, 1, 2];

          if (availableLanes.length > 0) {
            // Same as middle section: always spawn only 1 block
            const numLanesToSpawn = 1;
            
            // Deterministic lane selection: cycle through available lanes
            const lanesToSpawn = [];
            for (let i = 0; i < numLanesToSpawn; i++) {
              lanesToSpawn.push(availableLanes[(blockSpawnCount + i) % availableLanes.length]);
            }

            lanesToSpawn.forEach((laneIndex, idx) => {
              // Deterministic offset pattern (same as middle section)
              const offsetPattern = [3, 5, 4, 6, 3.5, 5.5];
              const offset = offsetPattern[(blockSpawnCount + idx) % offsetPattern.length];
              
              const block = new THREE.Mesh(
                new THREE.BoxGeometry(2, 2, 4),
                new THREE.MeshStandardMaterial({ 
                  color: 0xffffff,
                  metalness: 0.5,
                  roughness: 0.5,
                  emissive: 0xffffff,
                  emissiveIntensity: 0.4
                })
              );
              block.position.set(lanes[laneIndex], 1, carGroup.position.z - spawnDistance - offset);
              block.castShadow = true;
              block.userData.isFinalBlock = true;
              scene.add(block);
              finalBlocks.push(block);
            });
            
            blockSpawnCount++;
          }
        }
      }

      // Autopilot pending logic - wait for safe conditions before engaging
      if (!autopilotRef.current && autopilotPendingRef.current && elapsed >= 0) {
        let obstacleTooClose = false;
        const pendingObstacles: THREE.Mesh[] = [...otherCars, ...finalBlocks];
        pendingObstacles.forEach(obstacle => {
          const relativeZ = obstacle.position.z - carGroup.position.z;
          const relativeX = Math.abs(obstacle.position.x - carGroup.position.x);
          // Treat blocks within ~60 units ahead (and 15 units behind) as too close
          if (relativeZ < 15 && relativeZ > -60 && relativeX < 1.5) {
            obstacleTooClose = true;
          }
        });

        if (!obstacleTooClose) {
          autopilotPendingRef.current = false;
          setAutopilotPending(false);
          setIsAutopilot(true);
        }
      }

      // Autopilot control
      if (autopilotRef.current && elapsed >= 0 && !finishLineCrossed) {
        wasAutopilot = true;
        const previousAutopilotTimer = autopilotTimer;
        autopilotTimer += FIXED_DELTA; // Fixed timestep: increment by 1/60 second per step
        const autopilotHit90Tick = Math.floor(previousAutopilotTimer / 90) !== Math.floor(autopilotTimer / 90);
        
        // AUTOPILOT BLIND ZONE FAILURE LOGIC - COMMENTED OUT (we don't want autopilot to fail on purpose)
        // const approachingFinish = !finishLineCrossed && distanceToFinish > 0 && distanceToFinish < AUTOPILOT_BLIND_DISTANCE;
        // if (approachingFinish) {
        //   if (blindLaneStateRef.current.index === null) {
        //     const laneOptions = [0, 1, 2].filter(lane => lane !== currentLaneIndex);
        //     blindLaneStateRef.current.index = laneOptions.length > 0
        //       ? laneOptions[Math.floor(Math.random() * laneOptions.length)]
        //       : currentLaneIndex;
        //   }
        //
        //   const targetBlindLane = blindLaneStateRef.current.index ?? currentLaneIndex;
        //
        //   autopilotDecision = {
        //     accelerate: true,
        //     lane: targetBlindLane,
        //     targetSpeed: AUTOPILOT_SPEED_UNITS
        //   };
        //
        //   // Keep speed high; minimal braking so it blasts into finish blocks deliberately
        //   if (carVelocity < autopilotSpeed) {
        //     carVelocity = Math.min(carVelocity + 0.05 * 1.0, autopilotSpeed);
        //   } else if (carVelocity > autopilotSpeed) {
        //     carVelocity = Math.max(carVelocity - 0.05 * 1.0, autopilotSpeed);
        //   }
        // } else {
        
        const autopilotSpeed = AUTOPILOT_SPEED_UNITS; // 120 MPH equivalent
        const allObstacles: THREE.Mesh[] = [...otherCars, ...finalBlocks];

        // Normal autopilot behavior (no deliberate failure)
          const laneInfo = [
            { safe: true, nearestObstacle: Infinity },
            { safe: true, nearestObstacle: Infinity },
            { safe: true, nearestObstacle: Infinity }
          ];
          let emergencyStop = false;

          allObstacles.forEach(obstacle => {
            const relativeZ = obstacle.position.z - carGroup.position.z;
            // PERFECT AUTOPILOT: detect obstacles from very far away (increased range)
            if (relativeZ < 300 && relativeZ > -1200) {
              const obstacleX = obstacle.position.x;
              const distance = Math.abs(relativeZ);

              // No emergency stop needed - we detect early enough
              
              for (let i = 0; i < 3; i++) {
                const laneCenterX = lanes[i];
                const distanceFromLaneCenter = Math.abs(obstacleX - laneCenterX);
                // Very wide lane detection to catch everything (increased width)
                if (distanceFromLaneCenter < 2.0) {
                  if (distance < laneInfo[i].nearestObstacle) {
                    laneInfo[i].nearestObstacle = distance;
                  }
                  // Mark unsafe from very far away - change lanes early (increased distance)
                  if (distance < 1000) {
                    laneInfo[i].safe = false;
                  }
                }
              }
            }
          });

          // PERFECT AUTOPILOT: Always pick the safest lane (most distance to obstacle)
          let bestLane = currentLaneIndex;
          let maxDistance = laneInfo[currentLaneIndex].nearestObstacle;

          // Find the lane with the most clearance
          for (let i = 0; i < 3; i++) {
            if (laneInfo[i].nearestObstacle > maxDistance) {
              maxDistance = laneInfo[i].nearestObstacle;
              bestLane = i;
            }
          }

          // If current lane is unsafe, switch immediately to safest lane
          if (!laneInfo[currentLaneIndex].safe) {
            for (let i = 0; i < 3; i++) {
              if (laneInfo[i].safe) {
                bestLane = i;
                break;
              }
            }
          }

          // Prefer center lane when all lanes are clear (increased threshold for more conservative behavior)
          if (laneInfo[1].nearestObstacle > 800 && laneInfo[bestLane].nearestObstacle > 800) {
            bestLane = 1;
          }

          autopilotDecision = {
            accelerate: true,
            lane: bestLane,
            targetSpeed: AUTOPILOT_SPEED_UNITS
          };

          const bestLaneInfo = laneInfo[bestLane];
          // Only emergency brake when obstacle is very close (reduced sensitivity)
          const shouldEmergencyBrake = emergencyStop || (!bestLaneInfo.safe && bestLaneInfo.nearestObstacle < 60);

          let immediateObstacleAhead = false;
          allObstacles.forEach(obstacle => {
            const relativeZ = obstacle.position.z - carGroup.position.z;
            const relativeX = Math.abs(obstacle.position.x - carGroup.position.x);
            // Only detect immediate obstacles when very close (reduced sensitivity)
            if (relativeZ < 30 && relativeZ > -80 && relativeX < 1.5) {
              immediateObstacleAhead = true;
            }
          });

          // Smoother braking - only brake hard when absolutely necessary
          if (shouldEmergencyBrake) {
            carVelocity = Math.max(carVelocity - 0.06 * 1.0, 0.2); // Reduced braking force, higher minimum speed
          } else if (immediateObstacleAhead) {
            // Light braking when obstacle is close but not emergency
            carVelocity = Math.max(carVelocity - 0.02 * 1.0, 0.4); // Much lighter braking, higher minimum
          } else {
            // Normal acceleration/deceleration
            if (carVelocity < autopilotSpeed) {
              carVelocity = Math.min(carVelocity + 0.05 * 1.0, autopilotSpeed); // Fixed timestep: per-frame rate
            } else if (carVelocity > autopilotSpeed) {
              carVelocity = Math.max(carVelocity - 0.05 * 1.0, autopilotSpeed); // Fixed timestep: per-frame rate
          }
        }
 
        if (autopilotDecision.lane !== currentLaneIndex) {
          currentLaneIndex = autopilotDecision.lane;
          targetLane = lanes[currentLaneIndex];
          }
      } else {
        // Manual control - car starts moving automatically, player can accelerate/decelerate
        
        // Only allow movement after game starts
        if (gameStartedRef.current) {
          // When switching from autopilot to manual, cap speed immediately
          if (wasAutopilot) {
            carVelocity = Math.min(carVelocity, MANUAL_MAX_VELOCITY); // Cap to manual max (75 MPH)
            wasAutopilot = false;
          }
          
          // Auto-accelerate in manual mode (car starts moving automatically)
          if (carVelocity < MANUAL_MAX_VELOCITY) {
            carVelocity = Math.min(carVelocity + 0.005 * 1.0, MANUAL_MAX_VELOCITY); // Fixed timestep: gradual acceleration to max 75 MPH
          }
          
          // Player can accelerate further with ArrowUp
          if (keys.ArrowUp) {
            carVelocity = Math.min(carVelocity + 0.008 * 1.0, MANUAL_MAX_VELOCITY); // Max 75 MPH (MANUAL_MAX_VELOCITY carVelocity)
          }
          if (keys.ArrowDown) {
            carVelocity = Math.max(carVelocity - 0.025 * 1.0, 0);
          }
          if (keys.ArrowLeft && currentLaneIndex > 0) {
            currentLaneIndex--;
            targetLane = lanes[currentLaneIndex];
            keys.ArrowLeft = false;
          }
          if (keys.ArrowRight && currentLaneIndex < 2) {
            currentLaneIndex++;
            targetLane = lanes[currentLaneIndex];
            keys.ArrowRight = false;
          }
        } else {
          carVelocity = 0;
        }
      }

      // Large frame skip protection (not needed with fixed timestep, but keeping for safety)
      // if (autopilotRef.current && scaledDelta > 5) {
      //   carVelocity = AUTOPILOT_SPEED_UNITS;
      // }

      const laneChangeEase = autopilotRef.current ? 0.2 : 0.1;
      const laneChangeFactor = Math.min(laneChangeEase * 1.0, 1); // Fixed timestep: always 1.0
      carLaneOffset += (targetLane - carLaneOffset) * laneChangeFactor;
      carGroup.position.x = carLaneOffset;
      carGroup.position.z -= carVelocity * 1.0; // Fixed timestep: carVelocity is already in units per 60fps frame
      
      // Calculate speed in MPH (shared conversion factor for manual and autopilot)
      let speedMPH: number;
      if (autopilotRef.current) {
        speedMPH = Math.round(carVelocity * CAR_UNITS_TO_MPH);
        speedMPH = Math.min(AUTOPILOT_MAX_MPH, speedMPH);
      } else {
        speedMPH = Math.round(carVelocity * CAR_UNITS_TO_MPH);
        speedMPH = Math.min(MANUAL_MAX_MPH, speedMPH);
      }
      setSpeed(speedMPH);

      otherCars.forEach((car, index) => {
        car.position.z += 0.03 * 1.0; // Even slower traffic (fixed timestep)
        
        // Respawn far behind with huge spacing
        if (car.position.z > carGroup.position.z + 150) {
          car.position.z = carGroup.position.z - 800 - (index * 500);
          // Cycle through lanes in pattern
          const lanePattern = [0, 2, 1];
          car.position.x = lanes[lanePattern[index % lanePattern.length]];
          collisionCooldown.delete(index);
        }
        
        if (finishLineCrossed) {
          return;
        }
        
        // Collision detection with better tolerances
        const dx = Math.abs(car.position.x - carGroup.position.x);
        const dz = Math.abs(car.position.z - carGroup.position.z);
        
        if (dx < 1.3 && dz < 2.5) {
          if (!collisionCooldown.has(index) || frameCount - collisionCooldown.get(index) > 60) {
            scoreRef.current = Math.max(0, scoreRef.current - 10);
            setScore(scoreRef.current);
            
            const collisionUnit = Math.min(Math.floor(Math.abs(carGroup.position.z)), TRACK_LENGTH);
            const modeLabel = autopilotRef.current ? labelCondition.toLowerCase() : 'manual';
            simulationDataRef.current.collisionEvents.push({
              unit: collisionUnit,
              mode: modeLabel,
              lane: currentLaneIndex,
              z: carGroup.position.z,
              type: 'traffic'
            });
            
            if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
            setScoreFlash(true);
            flashTimeoutRef.current = window.setTimeout(() => setScoreFlash(false), 300);
            
            collisionCooldown.set(index, frameCount);
          }
        }
      });

      // Clean up blocks that are far behind the car (only if finish line not crossed)
      if (!finishLineCrossed) {
        for (let i = finalBlocks.length - 1; i >= 0; i--) {
          const block = finalBlocks[i];
          if (block.position.z > carGroup.position.z + 200) {
            // Clean up flash timeout if exists
            if (blockFlashTimeouts.has(block)) {
              clearTimeout(blockFlashTimeouts.get(block)!);
              blockFlashTimeouts.delete(block);
            }
            // Remove block from scene and array
            scene.remove(block);
            finalBlocks.splice(i, 1);
            continue;
          }
          
          const dx = Math.abs(block.position.x - carGroup.position.x);
          const dz = Math.abs(block.position.z - carGroup.position.z);
          
          const blockKey = `block_${i}`;
          if (dx < 1.8 && dz < 3) {
            if (!collisionCooldown.has(blockKey) || frameCount - collisionCooldown.get(blockKey) > 60) {
              scoreRef.current = Math.max(0, scoreRef.current - 10);
              setScore(scoreRef.current);
              
              const collisionUnit = Math.min(Math.floor(Math.abs(carGroup.position.z)), TRACK_LENGTH);
              const modeLabel = autopilotRef.current ? labelCondition.toLowerCase() : 'manual';
              simulationDataRef.current.collisionEvents.push({
                unit: collisionUnit,
                mode: modeLabel,
                lane: currentLaneIndex,
                z: carGroup.position.z,
                type: 'block',
                isBlindLane: !!block.userData.isBlindLane
              });
              
              // Track white block collision
              simulationDataRef.current.whiteBlocksHit++;
              if (block.userData.isBlindLane) {
                failureLaneHitsRef.current += 1;
                simulationDataRef.current.failureLaneHits = failureLaneHitsRef.current;
              }
              
              // Flash block red
              const material = block.material as THREE.MeshStandardMaterial;
              if (!block.userData.originalColor) {
                block.userData.originalColor = material.color.getHex();
                block.userData.originalEmissive = material.emissive.getHex();
                block.userData.originalEmissiveIntensity = material.emissiveIntensity;
              }
              
              // Clear any existing flash timeout for this block
              if (blockFlashTimeouts.has(block)) {
                clearTimeout(blockFlashTimeouts.get(block)!);
              }
              
              // Change to red
              material.color.setHex(0xff0000);
              material.emissive.setHex(0xff0000);
              material.emissiveIntensity = 0.5;
              
              // Restore original color after 300ms
              const timeoutId = window.setTimeout(() => {
                material.color.setHex(block.userData.originalColor);
                material.emissive.setHex(block.userData.originalEmissive);
                material.emissiveIntensity = block.userData.originalEmissiveIntensity;
                blockFlashTimeouts.delete(block);
              }, 300);
              
              blockFlashTimeouts.set(block, timeoutId);
              
              if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
              setScoreFlash(true);
              flashTimeoutRef.current = window.setTimeout(() => setScoreFlash(false), 300);
              
              collisionCooldown.set(blockKey, frameCount);
            }
          }
        }
      }

      roadSegments.forEach(road => {
        if (road.position.z > carGroup.position.z + 50) {
          road.position.z -= 1200;
        }
      });

      camera.position.x = carGroup.position.x;
      camera.position.z = carGroup.position.z + 8;
      camera.lookAt(carGroup.position.x, carGroup.position.y, carGroup.position.z - 5);

      // Check finish line crossing
      if (carGroup.position.z <= finishLineZ && !isCompleteRef.current && !finishLineCrossed) {
        finishLineCrossed = true;
        finishLineCrossTime = Date.now();
        
        // Calculate elapsed time when finish line is crossed (with 3 decimal places)
        const finishLineElapsed = startTimeRef.current && gameStartedRef.current
          ? parseFloat(((Date.now() - startTimeRef.current) / 1000).toFixed(3))
          : null;
        simulationDataRef.current.finishLineCrossSecond = finishLineElapsed;
        
        // Capture notification data at finish (use ref to get current state)
        const currentNotifications = notificationsRef.current;
        const allNotificationsSeen = currentNotifications.length > 0 && 
          currentNotifications.every(n => n.seen);
        
        if (allNotificationsSeen) {
          // All notifications seen - complete the simulation
          simulationDataRef.current.finalScore = scoreRef.current;
          simulationDataRef.current.failureLaneHits = failureLaneHitsRef.current;
          ensureModeByUnitComplete();
          
          simulationDataRef.current.notifications = currentNotifications;
          simulationDataRef.current.notificationsTotal = currentNotifications.length;
          simulationDataRef.current.notificationsSeen = currentNotifications.filter(n => n.seen).length;
          
          console.log('=== SIMULATION DATA ===');
          console.log('Mode by second:', simulationDataRef.current.modeBySecond);
          console.log('White blocks hit:', simulationDataRef.current.whiteBlocksHit);
          console.log('Failure-lane hits:', simulationDataRef.current.failureLaneHits);
          console.log('Mode by unit length:', simulationDataRef.current.modeByUnit.length);
          console.log('Collision events:', simulationDataRef.current.collisionEvents.length);
          console.log('Final score:', simulationDataRef.current.finalScore);
          console.log('Notifications total:', simulationDataRef.current.notificationsTotal);
          console.log('Notifications seen:', simulationDataRef.current.notificationsSeen);
          console.log('Notifications:', simulationDataRef.current.notifications);
          console.log('======================');

          if (typeof Qualtrics !== 'undefined') {
            Qualtrics.SurveyEngine.setEmbeddedData('sim_mode_by_second', JSON.stringify(simulationDataRef.current.modeBySecond));
            Qualtrics.SurveyEngine.setEmbeddedData('sim_white_blocks_hit', simulationDataRef.current.whiteBlocksHit);
            Qualtrics.SurveyEngine.setEmbeddedData('sim_failure_lane_hits', simulationDataRef.current.failureLaneHits);
            Qualtrics.SurveyEngine.setEmbeddedData('sim_mode_by_unit', JSON.stringify(simulationDataRef.current.modeByUnit));
            Qualtrics.SurveyEngine.setEmbeddedData('sim_collision_events', JSON.stringify(simulationDataRef.current.collisionEvents));
            Qualtrics.SurveyEngine.setEmbeddedData('sim_final_score', simulationDataRef.current.finalScore);
            Qualtrics.SurveyEngine.setEmbeddedData('sim_finish_line_cross_second', simulationDataRef.current.finishLineCrossSecond !== null ? simulationDataRef.current.finishLineCrossSecond : '');
            Qualtrics.SurveyEngine.setEmbeddedData('sim_notifications', JSON.stringify(simulationDataRef.current.notifications));
            Qualtrics.SurveyEngine.setEmbeddedData('sim_notifications_total', simulationDataRef.current.notificationsTotal);
            Qualtrics.SurveyEngine.setEmbeddedData('sim_notifications_seen', simulationDataRef.current.notificationsSeen);
            // Export notification open duration data
            const notificationsWithDuration = currentNotifications.map((n: Notification) => ({
              id: n.id,
              totalOpenDuration: n.totalOpenDuration,
              openSessions: n.openSessions
            }));
            Qualtrics.SurveyEngine.setEmbeddedData('sim_notifications_open_duration', JSON.stringify(notificationsWithDuration));
            console.log('Data saved to Qualtrics embedded data');
          }

          // Remove all blocks immediately
          finalBlocks.forEach(block => {
            scene.remove(block);
          });
          finalBlocks.length = 0;
          
          setIsComplete(true);
          clearInterval(timerInterval);
          setShowViewAllNotificationsPopup(false);
        } else {
          // Not all notifications seen - keep simulation running and show popup
          setShowViewAllNotificationsPopup(true);
        }
      }
      
      // Check if all notifications are now seen (after finish line crossed)
      if (finishLineCrossed && !isCompleteRef.current) {
        const currentNotifications = notificationsRef.current;
        const allNotificationsSeen = currentNotifications.length > 0 && 
          currentNotifications.every(n => n.seen);
        
        if (allNotificationsSeen) {
          // All notifications now seen - complete the simulation
          simulationDataRef.current.finalScore = scoreRef.current;
          simulationDataRef.current.failureLaneHits = failureLaneHitsRef.current;
          ensureModeByUnitComplete();
          
          simulationDataRef.current.notifications = currentNotifications;
          simulationDataRef.current.notificationsTotal = currentNotifications.length;
          simulationDataRef.current.notificationsSeen = currentNotifications.filter(n => n.seen).length;
          
          console.log('=== SIMULATION DATA ===');
          console.log('Mode by second:', simulationDataRef.current.modeBySecond);
          console.log('White blocks hit:', simulationDataRef.current.whiteBlocksHit);
          console.log('Failure-lane hits:', simulationDataRef.current.failureLaneHits);
          console.log('Mode by unit length:', simulationDataRef.current.modeByUnit.length);
          console.log('Collision events:', simulationDataRef.current.collisionEvents.length);
          console.log('Final score:', simulationDataRef.current.finalScore);
          console.log('Notifications total:', simulationDataRef.current.notificationsTotal);
          console.log('Notifications seen:', simulationDataRef.current.notificationsSeen);
          console.log('Notifications:', simulationDataRef.current.notifications);
          console.log('======================');

          if (typeof Qualtrics !== 'undefined') {
            Qualtrics.SurveyEngine.setEmbeddedData('sim_mode_by_second', JSON.stringify(simulationDataRef.current.modeBySecond));
            Qualtrics.SurveyEngine.setEmbeddedData('sim_white_blocks_hit', simulationDataRef.current.whiteBlocksHit);
            Qualtrics.SurveyEngine.setEmbeddedData('sim_failure_lane_hits', simulationDataRef.current.failureLaneHits);
            Qualtrics.SurveyEngine.setEmbeddedData('sim_mode_by_unit', JSON.stringify(simulationDataRef.current.modeByUnit));
            Qualtrics.SurveyEngine.setEmbeddedData('sim_collision_events', JSON.stringify(simulationDataRef.current.collisionEvents));
            Qualtrics.SurveyEngine.setEmbeddedData('sim_final_score', simulationDataRef.current.finalScore);
            Qualtrics.SurveyEngine.setEmbeddedData('sim_finish_line_cross_second', simulationDataRef.current.finishLineCrossSecond !== null ? simulationDataRef.current.finishLineCrossSecond : '');
            Qualtrics.SurveyEngine.setEmbeddedData('sim_notifications', JSON.stringify(simulationDataRef.current.notifications));
            Qualtrics.SurveyEngine.setEmbeddedData('sim_notifications_total', simulationDataRef.current.notificationsTotal);
            Qualtrics.SurveyEngine.setEmbeddedData('sim_notifications_seen', simulationDataRef.current.notificationsSeen);
            // Export notification open duration data
            const notificationsWithDuration = currentNotifications.map((n: Notification) => ({
              id: n.id,
              totalOpenDuration: n.totalOpenDuration,
              openSessions: n.openSessions
            }));
            Qualtrics.SurveyEngine.setEmbeddedData('sim_notifications_open_duration', JSON.stringify(notificationsWithDuration));
            console.log('Data saved to Qualtrics embedded data');
          }

          // Remove all blocks immediately
          finalBlocks.forEach(block => {
            scene.remove(block);
          });
          finalBlocks.length = 0;
          
          setIsComplete(true);
          clearInterval(timerInterval);
          setShowViewAllNotificationsPopup(false);
        }
      }
      
      // Stop car after 5 seconds of coasting past finish line (only if all notifications are seen)
      if (finishLineCrossed && finishLineCrossTime && isCompleteRef.current) {
        const timeSinceFinish = (Date.now() - finishLineCrossTime) / 1000;
        if (timeSinceFinish >= 5) {
          carVelocity = 0;
        }
      }

        accumulatedTime -= FIXED_DELTA;
      } // End of fixed timestep loop

      // Render at variable rate (visual only, doesn't affect determinism)
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      if (animationId !== undefined) {
        cancelAnimationFrame(animationId);
      }
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(timerInterval);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      if (container && renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    // Outer container: fills available space, prevents scrolling, centers content
    <div 
      ref={wrapperRef}
      style={{ 
        width: '100%', 
        height: '100%',
        maxHeight: '100%',
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        background: '#000',
        overflow: 'hidden'
      }}
    >
      {/* Inner container: fixed base size, scaled to fit */}
      <div style={{ 
        width: '1067px',
        height: '600px',
        position: 'relative',
        overflow: 'hidden',
        transform: `scale(${scale})`,
        transformOrigin: 'center center'
      }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        
        {countdown !== null && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1001,
            color: 'white'
          }}>
          <div style={{
            fontSize: '108px',
            fontWeight: 'bold',
            color: countdown === 0 ? '#44ff44' : '#ffd700',
            textShadow: '0 0 20px rgba(255, 255, 255, 0.5)'
          }}>
            {countdown === 0 ? 'GO!' : countdown}
          </div>
          </div>
        )}
        
        {showInstructions && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0, 0, 0, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
            color: 'white',
            padding: '36px',
            boxSizing: 'border-box'
          }}>
            <div style={{
              maxWidth: '810px',
              width: '90%',
              textAlign: 'center',
              fontSize: '16px',
              lineHeight: '1.6'
            }}>
              <h1 style={{ fontSize: '32px', marginBottom: '20px', color: '#ffd700' }}>
                🚗 AEON {labelCondition} Simulation 🚗
              </h1>
              <p style={{ marginBottom: '18px' }}>
                This is a driving simulation. Your goal is to reach the Finish Line and read all your smartphone notifications safely.
              </p>
              <p style={{ marginBottom: '18px' }}>
                You start in <strong style={{ textDecoration: 'underline' }}>{labelCondition}</strong>. You can switch to manual mode using the "Return to Manual" button. In manual mode, you can navigate using the arrow keys (up, down, left, right). You can also switch back to <strong style={{ textDecoration: 'underline' }}>{labelCondition}</strong> mode from manual mode.
              </p>
              <p style={{ marginBottom: '18px' }}>
                You start with <strong style={{ color: '#44ff44' }}>1000</strong> points.
              </p>
              <p style={{ marginBottom: '18px' }}>
                You lose <strong style={{ color: '#ff4444' }}>10 points</strong> per obstacle hit and <strong style={{ color: '#ff4444' }}>5 points</strong> per second that passes. Time will only stop passing once you reach the finish line AND you have read all your smartphone notifications.
              </p>
              <p style={{ marginBottom: '18px' }}>
                Each time you receive a smartphone notification, it will appear at the bottom of your screen. You can open and read these notifications whenever you deem it safe. 
              </p>
              <p style={{ marginBottom: '18px' }}> <strong>Important: after the simulation we will ask you questions about what you read in the notifications, so read each notification carefully so that you can remember what it says.</strong></p>
              <p style={{ marginBottom: '10px' }}>
                To read a notification, click the icon, read the message, then close the message.
              </p>
              
              <button
                onClick={startGame}
                style={{
                  padding: '14px 36px',
                  fontSize: '18px',
                  fontWeight: 'bold',
                  background: '#44ff44',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  transition: 'all 0.3s'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = '#33ee33'}
                onMouseOut={(e) => e.currentTarget.style.background = '#44ff44'}
              >
                START COPILOT
              </button>
            </div>
          </div>
        )}
        
        {gameStarted && (
          <>
            <div style={{
              position: 'absolute',
              top: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: '18px',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100
            }}>
              <div style={{
                background: 'rgba(0, 0, 0, 0.65)',
                color: 'white',
                padding: '9px 18px',
                borderRadius: '8px',
                fontSize: '18px',
                fontFamily: 'monospace',
                fontWeight: 'bold'
              }}>
                ⏱ {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
              </div>
              <div style={{
                background: isAutopilot ? 'rgba(138, 43, 226, 0.25)' : 'rgba(0, 0, 0, 0.7)',
                color: isAutopilot ? '#debaff' : '#ffffff',
                padding: isAutopilot ? '14px 25px' : '11px 22px',
                borderRadius: '50px',
                fontSize: isAutopilot ? '27px' : '20px',
                fontFamily: 'monospace',
                fontWeight: 'bold',
                border: isAutopilot ? '2px solid rgba(138, 43, 226, 0.6)' : '1px solid rgba(255,255,255,0.45)',
                boxShadow: isAutopilot ? '0 0 18px rgba(138, 43, 226, 0.45)' : 'none',
                transition: 'all 0.3s ease'
              }}>
                {speed} MPH
              </div>
              <div style={{
                background: 'rgba(0, 0, 0, 0.65)',
                color: scoreFlash ? '#ff4444' : (score > 500 ? '#44ff44' : score > 250 ? '#ffaa44' : '#ff4444'),
                padding: '9px 18px',
                borderRadius: '8px',
                fontSize: '18px',
                fontFamily: 'monospace',
                fontWeight: 'bold',
                transition: 'color 0.1s ease'
              }}>
                Score: {score}
              </div>
            </div>
            <div style={{
              position: 'absolute',
              top: '90px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '52%',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              zIndex: 100
            }}>
              <div style={{
                color: 'rgba(255, 255, 255, 0.8)',
                fontSize: '12px',
                fontFamily: 'Arial, sans-serif',
                letterSpacing: '0.5px',
                whiteSpace: 'nowrap'
              }}>
                Progress
              </div>
              <div style={{
                flexGrow: 1,
                height: '9px',
                background: 'rgba(255, 255, 255, 0.2)',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.35)',
                overflow: 'hidden',
                boxShadow: '0 0 8px rgba(0, 0, 0, 0.2)'
              }}>
                <div style={{
                  width: `${Math.min(progress, 1) * 100}%`,
                  height: '100%',
                  background: inBlindZone ? 'linear-gradient(90deg, #ffaa44, #ff4444)' : 'linear-gradient(90deg, #44ff44, #22aaee)',
                  transition: 'width 0.2s ease-out, background 0.3s ease'
                }} />
              </div>
            </div>
            {isAutopilot && (
              <style>{`
                @keyframes pulse {
                  0%, 100% { transform: scale(1); }
                  50% { transform: scale(1.05); }
                }
              `}</style>
            )}
          </>
        )}

        {!isComplete && gameStarted && (
          <div style={{
            position: 'absolute',
            bottom: '180px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
            zIndex: 100
          }}>
            <div style={{
              minWidth: '200px',
              textAlign: 'center',
              background: isAutopilot
                ? 'rgba(68, 255, 68, 0.25)'
                : autopilotPending
                ? 'rgba(255, 170, 68, 0.35)'
                : 'rgba(0, 0, 0, 0.55)',
              color: isAutopilot ? '#44ff44' : autopilotPending ? '#ffaa44' : 'rgba(255,255,255,0.75)',
              padding: isAutopilot ? '11px 22px' : '9px 20px',
              borderRadius: '999px',
              fontFamily: 'Arial, sans-serif',
              fontWeight: isAutopilot ? 'bold' : 'normal',
              border: isAutopilot ? '2px solid rgba(68, 255, 68, 0.6)' : '1px solid rgba(255,255,255,0.25)',
              boxShadow: isAutopilot ? '0 0 12px rgba(68, 255, 68, 0.4)' : 'none',
              transition: 'all 0.3s ease',
              letterSpacing: '0.8px'
            }}>
              {isAutopilot
                ? `${labelCondition.toUpperCase()} ENGAGED`
                : autopilotPending
                ? `⏳ ${labelCondition.toUpperCase()} WAITING`
                : '👤 MANUAL CONTROL'}
            </div>

            <button
              onClick={handleToggleAutopilot}
              style={{
                padding: '13px 32px',
                fontSize: '16px',
                fontWeight: 'bold',
                background: isAutopilot ? '#ff4444' : autopilotPending ? '#ffaa44' : '#44ff44',
                color: 'white',
                border: 'none',
                borderRadius: '999px',
                cursor: 'pointer',
                transition: 'all 0.25s'
              }}
            >
              {isAutopilot ? 'Return to Manual' : autopilotPending ? `Cancel ${labelCondition}` : `Enable ${labelCondition}`}
            </button>
          </div>
        )}

        {/* "New Notification" Popup */}
        {showNewNotificationPopup && (
          <div style={{
            position: 'absolute',
            top: '150px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.9)',
            color: 'white',
            padding: '11px 22px',
            borderRadius: '8px',
            fontSize: '14px',
            fontFamily: 'Arial, sans-serif',
            zIndex: 1500,
            animation: 'fadeInOut 2s ease-in-out',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.3)'
          }}>
            📱 You have a new notification
          </div>
        )}

        {/* "View All Notifications" Popup - Persistent reminder */}
        {showViewAllNotificationsPopup && (
          <div style={{
            position: 'absolute',
            top: '150px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255, 68, 68, 0.95)',
            color: 'white',
            padding: '13px 25px',
            borderRadius: '8px',
            fontSize: '15px',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            zIndex: 1500,
            boxShadow: '0 4px 16px rgba(255, 68, 68, 0.6)',
            border: '2px solid rgba(255, 255, 255, 0.5)',
            animation: 'pulse 2s ease-in-out infinite'
          }}>
            ⚠️ Please view all notifications to complete the simulation!
          </div>
        )}

        {/* Notification Icons Bar - Bottom of Screen */}
        {gameStarted && notifications.length > 0 && (
          <div style={{
            position: 'absolute',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            zIndex: 1000,
            background: 'rgba(0, 0, 0, 0.6)',
            padding: '9px 18px',
            borderRadius: '15px',
            backdropFilter: 'blur(10px)'
          }}>
            {notifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => {
                  setSelectedNotification(notif);
                  
                  // Calculate current elapsed time (with 3 decimal places)
                  const clickedSecond = startTimeRef.current && gameStartedRef.current
                    ? parseFloat(((Date.now() - startTimeRef.current) / 1000).toFixed(3))
                    : null;
                  
                  // Mark as seen and record click time
                  setNotifications(prev => {
                    const updated = prev.map(n => {
                      if (n.id === notif.id && !n.seen) {
                        // Only update if not already seen (first click)
                        const reactionTime = clickedSecond !== null && n.arrivalSecond !== null
                          ? parseFloat((clickedSecond - n.arrivalSecond).toFixed(3))
                          : null;
                        return { 
                          ...n, 
                          seen: true,
                          clickedSecond: clickedSecond,
                          reactionTime: reactionTime
                        };
                      }
                      return n;
                    });
                    notificationsRef.current = updated; // Keep ref in sync
                    return updated;
                  });
                }}
                style={{
                  width: '54px',
                  height: '54px',
                  borderRadius: '11px',
                  background: notif.seen 
                    ? 'rgba(100, 100, 100, 0.5)' 
                    : 'rgba(68, 255, 68, 0.3)',
                  border: notif.seen 
                    ? '2px solid rgba(150, 150, 150, 0.5)' 
                    : '2px solid rgba(68, 255, 68, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '29px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: notif.seen 
                    ? 'none' 
                    : '0 0 12px rgba(68, 255, 68, 0.5)',
                  position: 'relative'
                }}
                onMouseEnter={(e) => {
                  if (!notif.seen) {
                    e.currentTarget.style.transform = 'scale(1.1)';
                    e.currentTarget.style.boxShadow = '0 0 20px rgba(68, 255, 68, 0.8)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  if (!notif.seen) {
                    e.currentTarget.style.boxShadow = '0 0 12px rgba(68, 255, 68, 0.5)';
                  }
                }}
              >
                {notif.icon}
                {!notif.seen && (
                  <div style={{
                    position: 'absolute',
                    top: '-5px',
                    right: '-5px',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    background: '#ff4444',
                    border: '2px solid white'
                  }} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Full Notification View - When Icon is Clicked */}
        {selectedNotification && (
          <div 
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(540px, 90vw)',
              maxHeight: '90vh',
              minHeight: '360px',
            background: 'rgba(0, 0, 0, 0.95)',
            backdropFilter: 'blur(10px)',
              borderRadius: '18px',
              padding: 'min(36px, 4vh)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            border: '2px solid rgba(255, 255, 255, 0.2)',
            zIndex: 2000,
            animation: 'slideIn 0.3s ease-out',
            display: 'flex',
            flexDirection: 'column',
              overflow: 'visible',
              boxSizing: 'border-box'
            }}
            onClick={(e) => {
              // Close when clicking outside the content
              if (e.target === e.currentTarget) {
                setSelectedNotification(null);
              }
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: 'min(20px, 2vh)',
              gap: '15px',
              flexShrink: 0
            }}>
              <div style={{ fontSize: 'min(43px, 5vw)' }}>{selectedNotification.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 'min(25px, 3.5vw)',
                  fontWeight: 'bold',
                  color: '#ffffff',
                  marginBottom: '5px'
                }}>
                  {selectedNotification.title}
                </div>
                <div style={{
                  fontSize: 'min(14px, 2vw)',
                  color: 'rgba(255, 255, 255, 0.6)'
                }}>
                  {selectedNotification.type === 'text' ? 'Text Message' : 
                   selectedNotification.type === 'news' ? 'News Alert' : 
                   selectedNotification.type === 'music' ? 'Music App' :
                   'Social Media'}
                </div>
              </div>
              <button
                onClick={() => setSelectedNotification(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '29px',
                  height: '29px',
                  color: 'white',
                  fontSize: '18px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.2s',
                  flexShrink: 0
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
              >
                ×
              </button>
            </div>
            <div style={{
              fontSize: 'min(18px, 2.5vw)',
              color: 'rgba(255, 255, 255, 0.9)',
              lineHeight: '1.6',
              overflow: 'visible',
              wordWrap: 'break-word'
            }}>
              {selectedNotification.content}
            </div>
          </div>
        )}

        <style>{`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translate(-50%, -50%) translateY(-20px);
            }
            to {
              opacity: 1;
              transform: translate(-50%, -50%) translateY(0);
            }
          }
          @keyframes fadeInOut {
            0%, 100% {
              opacity: 0;
              transform: translateX(-50%) translateY(-10px);
            }
            10%, 90% {
              opacity: 1;
              transform: translateX(-50%) translateY(0);
            }
          }
          @keyframes pulse {
            0%, 100% {
              opacity: 1;
              transform: translateX(-50%) scale(1);
            }
            50% {
              opacity: 0.9;
              transform: translateX(-50%) scale(1.02);
            }
          }
        `}</style>

        {isComplete && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0, 0, 0, 0.9)',
            color: 'white',
            padding: '36px 54px',
            borderRadius: '14px',
            fontSize: '29px',
            fontFamily: 'Arial, sans-serif',
            textAlign: 'center',
            fontWeight: 'bold'
          }}>
            ✅ Simulation Complete! ✅
            <div style={{ fontSize: '22px', marginTop: '18px' }}>
              Final Score: {score}
            </div>
            <div style={{ fontSize: '16px', marginTop: '14px', color: '#ffaa44' }}>
              Blocks Hit: {simulationDataRef.current.whiteBlocksHit}
            </div>
            <div style={{ fontSize: '13px', marginTop: '9px', color: '#aaaaaa' }}>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DrivingSimulator;