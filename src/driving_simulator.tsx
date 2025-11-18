import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
// Let TypeScript know Qualtrics exists globally
declare const Qualtrics: any;

const AUTOPILOT_BLIND_DISTANCE = 1000; // Units before the finish where autopilot goes blind
const TRACK_LENGTH = 7000; // Total distance from start to finish line in world units
const AUTOPILOT_SPEED_UNITS = 1.6; // carVelocity units corresponding to autopilot max speed
const AUTOPILOT_MAX_MPH = 120;
const MANUAL_MAX_MPH = 75;
const CAR_UNITS_TO_MPH = AUTOPILOT_MAX_MPH / AUTOPILOT_SPEED_UNITS;
const MANUAL_MAX_VELOCITY = MANUAL_MAX_MPH / CAR_UNITS_TO_MPH;
const labelCondition = 'Copilot';

// Notification timing (in seconds) - configurable
const NOTIFICATION_1_TIME = 8;  // First notification at 8 seconds
const NOTIFICATION_2_TIME = 20; // Second notification at 20 seconds
const NOTIFICATION_3_TIME = 32; // Third notification at 32 seconds
const NOTIFICATION_DURATION = 3; // How long each notification stays visible (seconds)

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
  type: 'text' | 'news' | 'social';
  title: string;
  content: string;
  icon?: string;
  timestamp: number;
}

const DrivingSimulator = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isAutopilot, setIsAutopilot] = useState(true); // Always in Copilot mode
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
  const [activeNotification, setActiveNotification] = useState<Notification | null>(null);
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
  const simulationDataRef = useRef<SimulationData>({
    modeBySecond: [], // Track mode at each second
    whiteBlocksHit: 0, // Count white block collisions
    failureLaneHits: 0,
    modeByUnit: [],
    collisionEvents: [],
    finalScore: 0
  });

  const startGame = () => {
    setShowInstructions(false);
    setCountdown(3);
    setIsAutopilot(true); // Always start in Copilot mode
    autopilotRef.current = true;
    autopilotPendingRef.current = false;
    setAutopilotPending(false);
    progressRef.current = 0;
    setProgress(0);
    setElapsedTime(0);
    setActiveNotification(null);
    failureLaneHitsRef.current = 0;
    lastDistanceUnitLoggedRef.current = -1;
    blindLaneStateRef.current = { index: null, prepopulated: false };
    simulationDataRef.current = {
      modeBySecond: [],
      whiteBlocksHit: 0,
      failureLaneHits: 0,
      modeByUnit: [],
      collisionEvents: [],
      finalScore: 0
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

  // No toggle function needed - always in Copilot mode

  const blindProgressThreshold = 1 - (AUTOPILOT_BLIND_DISTANCE / TRACK_LENGTH);
  const inBlindZone = progress >= blindProgressThreshold;

  useEffect(() => {
    autopilotRef.current = true; // Always in Copilot mode
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

    // White blocks - spawn throughout the game (reduced spawn rate for perfect avoidance)
    const finalBlocks: THREE.Mesh[] = [];
    const baseBlockSpawnDistance = 200; // Units travelled between regular spawns early in the race (increased for less aggressive spawning)
    const lateBlockSpawnDistance = 100;   // Units between late-race spawns as density rises
    const finishBurstSpawnDistance = 50; // Units between finish-line bursts
    let lastBlockSpawnZ = carGroup.position.z;
    let lastLateBlockSpawnZ = carGroup.position.z;
    let lastFinishBurstSpawnZ = carGroup.position.z;

    // Finish line (static) - commented out
    // const finishLineZ = -TRACK_LENGTH;
    // const finishLine = new THREE.Mesh(
    //   new THREE.PlaneGeometry(8, 2),
    //   new THREE.MeshBasicMaterial({ color: 0xffff00 })
    // );
    // finishLine.rotation.x = -Math.PI / 2;
    // finishLine.position.set(0, 0.03, finishLineZ);
    // scene.add(finishLine);

    // Game state
    let carVelocity = 0;
    let carLaneOffset = 0;
    let targetLane = 0;
    let currentLaneIndex = 1;
    const collisionCooldown = new Map();
    let wasAutopilot = false; // Track previous autopilot state
    let finishLineCrossed = false;
    let finishLineCrossTime: number | null = null;
    
    // No keyboard controls - always in Copilot mode

    // Timer - only start when game begins
    let lastScoreDeduction = 0;
    let lastSecondLogged = -1;
    
    const ensureModeByUnitComplete = () => {
      if (lastDistanceUnitLoggedRef.current >= TRACK_LENGTH) return;
      const modeLabel = labelCondition.toLowerCase(); // Always copilot
      for (let unit = lastDistanceUnitLoggedRef.current + 1; unit <= TRACK_LENGTH; unit++) {
        simulationDataRef.current.modeByUnit[unit] = modeLabel;
      }
      lastDistanceUnitLoggedRef.current = TRACK_LENGTH;
    };
    
    // Track which notifications have been shown
    const notificationsShown = new Set<number>();
    const notificationStartTimes = new Map<number, number>();
    
    const timerInterval = setInterval(() => {
      if (!startTimeRef.current || !gameStartedRef.current || isCompleteRef.current) return;
      
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedTime(elapsed);
      
      // Check for notification triggers
      const notificationTimes = [NOTIFICATION_1_TIME, NOTIFICATION_2_TIME, NOTIFICATION_3_TIME];
      notificationTimes.forEach((notifTime, index) => {
        if (elapsed === notifTime && !notificationsShown.has(index)) {
          notificationsShown.add(index);
          const notifId = index + 1;
          
          let notification: Notification;
          if (notifId === 1) {
            // Text message
            notification = {
              id: notifId,
              type: 'text',
              title: 'Sarah',
              content: 'Hey! Are we still on for dinner tonight?',
              icon: '💬',
              timestamp: Date.now()
            };
          } else if (notifId === 2) {
            // News article
            notification = {
              id: notifId,
              type: 'news',
              title: 'Breaking News',
              content: 'Tech stocks surge as AI adoption accelerates across industries',
              icon: '📰',
              timestamp: Date.now()
            };
          } else {
            // Social media
            notification = {
              id: notifId,
              type: 'social',
              title: 'Instagram',
              content: 'You have 5 new posts from people you follow',
              icon: '📸',
              timestamp: Date.now()
            };
          }
          
          setActiveNotification(notification);
          notificationStartTimes.set(notifId, Date.now());
          
          // Auto-dismiss after duration
          setTimeout(() => {
            setActiveNotification(null);
            notificationStartTimes.delete(notifId);
          }, NOTIFICATION_DURATION * 1000);
        }
      });
      
      // Log mode at each second
      if (elapsed !== lastSecondLogged) {
        simulationDataRef.current.modeBySecond.push({
          second: elapsed,
          mode: labelCondition.toLowerCase() // Always copilot
        });
        lastSecondLogged = elapsed;
      }
      
      const now = Date.now();
      if (lastScoreDeduction === 0) {
        lastScoreDeduction = now;
      }
      if (now - lastScoreDeduction >= 1000) {
        scoreRef.current = Math.max(0, scoreRef.current - 5);
        setScore(scoreRef.current);
        lastScoreDeduction = now;
      }
      
      // Check for completion at 45 seconds
      if (elapsed >= 45 && !finishLineCrossed) {
        finishLineCrossed = true;
        finishLineCrossTime = Date.now();
        simulationDataRef.current.finalScore = scoreRef.current;
        setIsComplete(true);
        clearInterval(timerInterval);
        
        // Remove all blocks immediately
        finalBlocks.forEach(block => {
          scene.remove(block);
        });
        finalBlocks.length = 0;
        
        // Log final data to console
        console.log('=== SIMULATION DATA ===');
        console.log('Mode by second:', simulationDataRef.current.modeBySecond);
        console.log('White blocks hit:', simulationDataRef.current.whiteBlocksHit);
        console.log('Final score:', simulationDataRef.current.finalScore);
        console.log('======================');
        
        // Save data to Qualtrics if available
        if (typeof Qualtrics !== 'undefined') {
          Qualtrics.SurveyEngine.setEmbeddedData('sim_mode_by_second', JSON.stringify(simulationDataRef.current.modeBySecond));
          Qualtrics.SurveyEngine.setEmbeddedData('sim_white_blocks_hit', simulationDataRef.current.whiteBlocksHit);
          Qualtrics.SurveyEngine.setEmbeddedData('sim_final_score', simulationDataRef.current.finalScore);
          console.log('Data saved to Qualtrics embedded data');
        }
      }
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
 
     // Animation
     let autopilotTimer = 0;
     let autopilotDecision: AutopilotDecision = { accelerate: true, lane: 1, targetSpeed: 1.3 };
     let animationId: number | undefined;
     let frameCount = 0;
    let lastAnimationTime = performance.now();
    const FRAME_MS = 1000 / 60;

    const animate = () => {
      animationId = requestAnimationFrame(animate);

      const now = performance.now();
      let deltaMs = now - lastAnimationTime;
      const deltaFactor = Math.max(deltaMs / (1000 / 60), 0.0001);
      const scaledDelta = Math.min(deltaFactor, 1);
      lastAnimationTime = now;
      frameCount += deltaFactor;

      // Allow car movement even before game starts, but only run game logic after start
      const elapsed = startTimeRef.current && gameStartedRef.current 
        ? Math.floor((Date.now() - startTimeRef.current) / 1000) 
        : -1;
      
      if (finishLineCrossed && finalBlocks.length > 0) {
        finalBlocks.forEach(block => {
          scene.remove(block);
        });
        finalBlocks.length = 0;

        // Log final data to console
        console.log('=== SIMULATION DATA ===');
        console.log('Mode by second:', simulationDataRef.current.modeBySecond);
        console.log('White blocks hit:', simulationDataRef.current.whiteBlocksHit);
        console.log('Failure-lane hits:', simulationDataRef.current.failureLaneHits);
        console.log('Mode by unit length:', simulationDataRef.current.modeByUnit.length);
        console.log('Collision events:', simulationDataRef.current.collisionEvents.length);
        console.log('Final score:', simulationDataRef.current.finalScore);
        console.log('======================');

        // Save data to Qualtrics if available
        if (typeof Qualtrics !== 'undefined') {
          Qualtrics.SurveyEngine.setEmbeddedData('sim_mode_by_second', JSON.stringify(simulationDataRef.current.modeBySecond));
          Qualtrics.SurveyEngine.setEmbeddedData('sim_white_blocks_hit', simulationDataRef.current.whiteBlocksHit);
          Qualtrics.SurveyEngine.setEmbeddedData('sim_failure_lane_hits', simulationDataRef.current.failureLaneHits);
          Qualtrics.SurveyEngine.setEmbeddedData('sim_mode_by_unit', JSON.stringify(simulationDataRef.current.modeByUnit));
          Qualtrics.SurveyEngine.setEmbeddedData('sim_collision_events', JSON.stringify(simulationDataRef.current.collisionEvents));
          Qualtrics.SurveyEngine.setEmbeddedData('sim_final_score', simulationDataRef.current.finalScore);
          console.log('Data saved to Qualtrics embedded data');
        }
      }

      const distanceTravelled = Math.abs(carGroup.position.z);
      const trackLength = TRACK_LENGTH;
      const progressRatio = Math.min(distanceTravelled / trackLength, 1);
      const densityLevel = Math.min(Math.floor(progressRatio * 10), 10);
      // const distanceToFinish = carGroup.position.z - finishLineZ; // Finish line removed

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

      // Block spawning - simplified without finish line logic
      if (!finishLineCrossed && elapsed >= 0) {
        const distanceSinceLastSpawn = Math.abs(carGroup.position.z - lastBlockSpawnZ);
        const dynamicInterval = Math.max(55, baseBlockSpawnDistance - densityLevel * 7);
        if (distanceTravelled > 80 && distanceSinceLastSpawn >= dynamicInterval) {
          lastBlockSpawnZ = carGroup.position.z;
          const spawnDistance = 80;
          const laneIndex = Math.floor(Math.random() * lanes.length);
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
          const offset = 3 + (Math.random() * 4);
          block.position.set(lanes[laneIndex], 1, carGroup.position.z - spawnDistance - offset);
          block.castShadow = true;
          block.userData.isFinalBlock = true;
          scene.add(block);
          finalBlocks.push(block);
        }
      }

      // Finish burst spawning removed - finish line removed

      // Always in Copilot mode - no manual control
      if (elapsed >= 0) {
        autopilotRef.current = true;
        wasAutopilot = true;
        const previousAutopilotTimer = autopilotTimer;
        autopilotTimer += deltaFactor;
        const autopilotHit90Tick = Math.floor(previousAutopilotTimer / 90) !== Math.floor(autopilotTimer / 90);
        
        // const approachingFinish = !finishLineCrossed && distanceToFinish > 0 && distanceToFinish < AUTOPILOT_BLIND_DISTANCE; // Finish line removed
        const autopilotSpeed = AUTOPILOT_SPEED_UNITS; // 120 MPH equivalent
        const allObstacles: THREE.Mesh[] = [...otherCars, ...finalBlocks];

        // Finish line approach logic removed
        // if (approachingFinish) {
        if (false) { // Disabled - finish line removed
          if (blindLaneStateRef.current.index === null) {
            const laneOptions = [0, 1, 2].filter(lane => lane !== currentLaneIndex);
            blindLaneStateRef.current.index = laneOptions.length > 0
              ? laneOptions[Math.floor(Math.random() * laneOptions.length)]
              : currentLaneIndex;
          }

          const targetBlindLane = blindLaneStateRef.current.index ?? currentLaneIndex;

          autopilotDecision = {
            accelerate: true,
            lane: targetBlindLane,
            targetSpeed: AUTOPILOT_SPEED_UNITS
          };

          // Keep speed high; minimal braking so it blasts into finish blocks deliberately
          if (carVelocity < autopilotSpeed) {
            carVelocity = Math.min(carVelocity + 0.05 * scaledDelta, autopilotSpeed);
          } else if (carVelocity > autopilotSpeed) {
            carVelocity = Math.max(carVelocity - 0.05 * scaledDelta, autopilotSpeed);
          }
        } else {
          const laneInfo = [
            { safe: true, nearestObstacle: Infinity },
            { safe: true, nearestObstacle: Infinity },
            { safe: true, nearestObstacle: Infinity }
          ];
          let emergencyStop = false;

          allObstacles.forEach(obstacle => {
            const relativeZ = obstacle.position.z - carGroup.position.z;
            // More conservative: detect obstacles from further away
            if (relativeZ < 60 && relativeZ > -800) {
              const obstacleX = obstacle.position.x;
              const distance = Math.abs(relativeZ);

              // More conservative emergency stop
              if (distance < 50 && Math.abs(obstacleX - carGroup.position.x) < 1.8) {
                emergencyStop = true;
              }

              for (let i = 0; i < 3; i++) {
                const laneCenterX = lanes[i];
                const distanceFromLaneCenter = Math.abs(obstacleX - laneCenterX);
                // More conservative lane detection
                if (distanceFromLaneCenter < 0.8) {
                  if (distance < laneInfo[i].nearestObstacle) {
                    laneInfo[i].nearestObstacle = distance;
                  }
                  // Mark unsafe from further away for more conservative behavior
                  if (distance < 400) {
                    laneInfo[i].safe = false;
                  }
                }
              }
            }
          });

          let bestLane = currentLaneIndex;
          let maxDistance = laneInfo[currentLaneIndex].nearestObstacle;

          for (let i = 0; i < 3; i++) {
            if (laneInfo[i].nearestObstacle > maxDistance + 35) {
              maxDistance = laneInfo[i].nearestObstacle;
              bestLane = i;
            }
          }

          if (!laneInfo[currentLaneIndex].safe) {
            for (let i = 0; i < 3; i++) {
              if (laneInfo[i].safe && laneInfo[i].nearestObstacle > laneInfo[currentLaneIndex].nearestObstacle) {
                bestLane = i;
                maxDistance = laneInfo[i].nearestObstacle;
              }
            }
          }

          for (let i = 0; i < 3; i++) {
            if (laneInfo[i].nearestObstacle > laneInfo[bestLane].nearestObstacle) {
              bestLane = i;
            }
          }

          if (laneInfo[bestLane].nearestObstacle > 450 && bestLane !== 1 && laneInfo[1].nearestObstacle > 450) {
            if (autopilotHit90Tick) {
              bestLane = 1;
            }
          }

          autopilotDecision = {
            accelerate: true,
            lane: bestLane,
            targetSpeed: AUTOPILOT_SPEED_UNITS
          };

          const bestLaneInfo = laneInfo[bestLane];
          const shouldEmergencyBrake = emergencyStop || (!bestLaneInfo.safe && bestLaneInfo.nearestObstacle < 120);

          let immediateObstacleAhead = false;
          allObstacles.forEach(obstacle => {
            const relativeZ = obstacle.position.z - carGroup.position.z;
            const relativeX = Math.abs(obstacle.position.x - carGroup.position.x);
            // More conservative: detect from further away
            if (relativeZ < 35 && relativeZ > -100 && relativeX < 1.5) {
              immediateObstacleAhead = true;
            }
          });

          if (shouldEmergencyBrake) {
            carVelocity = Math.max(carVelocity - 0.08 * scaledDelta, 0.15);
          } else if (immediateObstacleAhead) {
            carVelocity = Math.max(carVelocity - 0.05 * scaledDelta, 0.25);
          } else {
            if (carVelocity < autopilotSpeed) {
              carVelocity = Math.min(carVelocity + 0.05 * scaledDelta, autopilotSpeed);
            } else if (carVelocity > autopilotSpeed) {
              carVelocity = Math.max(carVelocity - 0.08 * scaledDelta, autopilotSpeed);
            }
          }
        }
 
        if (autopilotDecision.lane !== currentLaneIndex) {
          currentLaneIndex = autopilotDecision.lane;
          targetLane = lanes[currentLaneIndex];
        }
      }

      if (autopilotRef.current && deltaFactor > 5) {
        carVelocity = AUTOPILOT_SPEED_UNITS;
      }

      const laneChangeEase = autopilotRef.current ? 0.2 : 0.1;
      const laneChangeFactor = Math.min(laneChangeEase * scaledDelta, 1);
      carLaneOffset += (targetLane - carLaneOffset) * laneChangeFactor;
      carGroup.position.x = carLaneOffset;
      carGroup.position.z -= carVelocity * deltaFactor;
      
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
        car.position.z += 0.03 * deltaFactor; // Even slower traffic
        
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

      // Check finish line crossing - removed (finish line removed, completion based on timer only)
      // Completion is now handled in the timer interval at 45 seconds
      
      // Stop car logic removed - finish line removed
      // if (finishLineCrossed && finishLineCrossTime) {
      //   const timeSinceFinish = (Date.now() - finishLineCrossTime) / 1000;
      //   if (timeSinceFinish >= 5) {
      //     carVelocity = 0;
      //   }
      // }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      if (animationId !== undefined) {
        cancelAnimationFrame(animationId);
      }
      window.removeEventListener('resize', handleResize);
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
    <div style={{ width: '100%', height: '100vh', overflow: 'hidden', position: 'relative' }}>
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
            fontSize: '120px',
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
          justifyContent: 'flex-start',
          alignItems: 'center',
          zIndex: 1000,
          color: 'white',
          padding: '40px',
          paddingTop: '80px'
        }}>
          <div style={{
            maxWidth: '600px',
            textAlign: 'center',
            fontSize: '18px',
            lineHeight: '1.6'
          }}>
            <h1 style={{ fontSize: '36px', marginBottom: '30px', color: '#ffd700' }}>
              🚗 {labelCondition} Simulation 🚗
            </h1>
            <div style={{ fontSize: '20px', marginBottom: '20px', fontWeight: 'bold' }}>
              Watch the Simulation:
            </div>
            <p style={{ marginBottom: '15px' }}>
              You are about to watch a <strong>{labelCondition} simulation</strong>. The vehicle will drive autonomously using {labelCondition.toLowerCase()} technology. <strong>You do not need to interact with the simulation</strong>—simply observe how the {labelCondition.toLowerCase()} handles the driving.
            </p>
            <p style={{ marginBottom: '15px' }}>
              The simulation will last <strong>45 seconds</strong>. During this time, you may see notifications appear on screen—these represent typical smartphone notifications that might appear while the {labelCondition.toLowerCase()} is driving.
            </p>
            <p style={{ marginBottom: '15px', color: '#99ff99' }}>
              💰 You will receive a bonus of <strong>$0.50</strong> for watching the whole simulation.
            </p>
            <button
              onClick={startGame}
              style={{
                padding: '15px 40px',
                fontSize: '20px',
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
              START
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
            justifyContent: 'center'
          }}>
            <div style={{
              background: 'rgba(0, 0, 0, 0.65)',
              color: 'white',
              padding: '10px 20px',
              borderRadius: '8px',
              fontSize: '20px',
              fontFamily: 'monospace',
              fontWeight: 'bold'
            }}>
              ⏱ {Math.floor((45 - elapsedTime) / 60)}:{((45 - elapsedTime) % 60).toString().padStart(2, '0')}
            </div>
            <div style={{
              background: isAutopilot ? 'rgba(138, 43, 226, 0.25)' : 'rgba(0, 0, 0, 0.7)',
              color: isAutopilot ? '#debaff' : '#ffffff',
              padding: isAutopilot ? '16px 28px' : '12px 24px',
              borderRadius: '50px',
              fontSize: isAutopilot ? '30px' : '22px',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              border: isAutopilot ? '2px solid rgba(138, 43, 226, 0.6)' : '1px solid rgba(255,255,255,0.45)',
              boxShadow: isAutopilot ? '0 0 18px rgba(138, 43, 226, 0.45)' : 'none',
              transition: 'all 0.3s ease'
            }}>
              {speed} MPH
            </div>
            {/* Score display removed - still tracking in background
            <div style={{
              background: scoreFlash ? '#ff0000' : 'rgba(0, 0, 0, 0.65)',
              color: scoreFlash ? 'white' : (score > 500 ? '#44ff44' : score > 250 ? '#ffaa44' : '#ff4444'),
              padding: '10px 20px',
              borderRadius: '8px',
              fontSize: '20px',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              transition: 'background 0.1s, color 0.1s'
            }}>
              Score: {score}
            </div>
            */}
          </div>
          {/* Progress bar removed
          <div style={{
            position: 'absolute',
            top: '130px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '52%',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <div style={{
              color: 'rgba(255, 255, 255, 0.8)',
              fontSize: '13px',
              fontFamily: 'Arial, sans-serif',
              letterSpacing: '0.5px',
              whiteSpace: 'nowrap'
            }}>
              Progress
            </div>
            <div style={{
              flexGrow: 1,
              height: '10px',
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
          */}
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
          bottom: '30px',
          left: '50%',
          transform: 'translateX(-50%)',
          textAlign: 'center'
        }}>
          <div style={{
            minWidth: '220px',
            textAlign: 'center',
            background: 'rgba(68, 255, 68, 0.25)',
            color: '#44ff44',
            padding: '12px 24px',
            borderRadius: '999px',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            border: '2px solid rgba(68, 255, 68, 0.6)',
            boxShadow: '0 0 12px rgba(68, 255, 68, 0.4)',
            transition: 'all 0.3s ease',
            letterSpacing: '0.8px'
          }}>
            🤖 {labelCondition.toUpperCase()} ACTIVE
          </div>
        </div>
      )}

      {/* Notification Overlay */}
      {activeNotification && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '90%',
          maxWidth: '600px',
          background: 'rgba(0, 0, 0, 0.85)',
          backdropFilter: 'blur(10px)',
          borderRadius: '20px',
          padding: '40px',
          zIndex: 2000,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          border: '2px solid rgba(255, 255, 255, 0.2)',
          animation: 'slideIn 0.3s ease-out'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '15px',
            gap: '12px'
          }}>
            <div style={{ fontSize: '32px' }}>{activeNotification.icon}</div>
            <div>
              <div style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#ffffff',
                marginBottom: '4px'
              }}>
                {activeNotification.title}
              </div>
              <div style={{
                fontSize: '12px',
                color: 'rgba(255, 255, 255, 0.6)'
              }}>
                {activeNotification.type === 'text' ? 'Text Message' : 
                 activeNotification.type === 'news' ? 'News Alert' : 
                 'Social Media'}
              </div>
            </div>
          </div>
          <div style={{
            fontSize: '16px',
            color: 'rgba(255, 255, 255, 0.9)',
            lineHeight: '1.5'
          }}>
            {activeNotification.content}
          </div>
          <div style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            fontSize: '20px',
            color: 'rgba(255, 255, 255, 0.5)',
            cursor: 'default'
          }}>
            📱
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translate(-50%, -60%);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%);
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
          padding: '40px 60px',
          borderRadius: '15px',
          fontSize: '32px',
          fontFamily: 'Arial, sans-serif',
          textAlign: 'center',
          fontWeight: 'bold'
        }}>
          ✅ Simulation Complete! ✅
          <div style={{ fontSize: '18px', marginTop: '20px', color: '#ffaa44' }}>
            Blocks Hit: {simulationDataRef.current.whiteBlocksHit}
          </div>
          <div style={{ fontSize: '14px', marginTop: '10px', color: '#aaaaaa' }}>
          </div>
        </div>
      )}
    </div>
  );
};

export default DrivingSimulator;