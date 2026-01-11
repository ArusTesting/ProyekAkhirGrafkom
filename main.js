import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';

let scene, camera, renderer, mixer, clock, controls;
// Physics variables
const mapMeshes = [];
const cars = []; // Global cars array
const raycaster = new THREE.Raycaster();
const gravity = 20.0; 
const cameraGroundRaycaster = new THREE.Raycaster();

// --- Path Editor Variables ---
let isEditorEnabled = false;
const waypoints = []; // Array of mesh markers
const waypointObjects = []; // Helper for DragControls
let curveLine = null;
let dragControls = null;
// History Stacks for Undo/Redo
const undoStack = [];
const redoStack = [];

// Assigned Paths
const assignedPaths = {
    ae86: { curve: null, line: null, points: [] },
    rx7: { curve: null, line: null, points: [] }
};
let isRacing = false;
let raceTime = 0;

// --- WASD Driving Controls ---
const keys = { w: false, a: false, s: false, d: false };
let currentSpeed = 0;
let currentSteerVal = 0;
let activeCarIndex = 0; // 0 = AE86, 1 = RX7
const driveConfig = {
    acceleration: 0.5,
    maxSpeed: 35,
    steerSpeed: 2.0,
    friction: 0.98
};

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = true;
});
window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
});

// init(); // Moved to end of file
// animate(); // Moved to end of file

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa0a0a0); // Grey sky (change if you want)
    scene.fog = new THREE.Fog(0xa0a0a0, 10, 500); // Fog to hide the edge of the world

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 20, 50); // Start position (Up and Back)

    renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; // Enable shadows
    document.body.appendChild(renderer.domElement);

 // --- Lighting ---
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
hemiLight.position.set(0, 200, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1); // Sun
dirLight.position.set(50, 200, 100);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 500;
dirLight.shadow.camera.left = -200;
dirLight.shadow.camera.right = 200;
dirLight.shadow.camera.top = 200;
dirLight.shadow.camera.bottom = -200;
scene.add(dirLight);

// Global Environment State
let isNight = false;
let areHeadlightsOn = false;

function toggleDayNight() {
    isNight = !isNight;
    
    if (isNight) {
        // Night Mode
        hemiLight.color.setHex(0x080820); // Dark Blue
        hemiLight.groundColor.setHex(0x000000); // Black ground
        hemiLight.intensity = 0.3; // Increased from 0.1 for visibility
        
        // MOONLIGHT (Faint Directional Light)
        dirLight.intensity = 0.2; 
        dirLight.color.setHex(0xaaccff); // Cool blue moon
        dirLight.castShadow = true; // Optional: shadows at night? User might like it.
        
        scene.background = new THREE.Color(0x050510); // Slightly lighter black
        scene.fog = new THREE.FogExp2(0x050510, 0.002);
    } else {
        // Day Mode
        hemiLight.color.setHex(0xffffff);
        hemiLight.groundColor.setHex(0x444444);
        hemiLight.intensity = 0.6;
        
        dirLight.intensity = 1; // Turn on Sun
        dirLight.color.setHex(0xffffff);
        dirLight.castShadow = true;
        
        scene.background = new THREE.Color(0x87CEEB); // Sky Blue
        scene.fog = new THREE.FogExp2(0x87CEEB, 0.001); // Thinner fog
    }
}

function createHeadlights(carGroup, config = {}) {
    if (!carGroup) return;
    
    // Default Config (AE86 approximate)
    const x = config.x !== undefined ? config.x : 0.8;
    const y = config.y !== undefined ? config.y : 0.6; // Lowered from 0.8
    const z = config.z !== undefined ? config.z : -1.8; // Pulled back from -2.1
    const bulbSize = config.bulbSize !== undefined ? config.bulbSize : 0.1;
    const targetDist = config.targetDist !== undefined ? config.targetDist : -20;
    
    // Create Headlights container
    const headlights = new THREE.Group();
    headlights.name = "headlights";
    
    // Left Light
    const spotL = new THREE.SpotLight(0xffffee, 10.0); 
    spotL.angle = 1.0; 
    spotL.penumbra = 0.3;
    spotL.decay = 2;
    spotL.distance = 200;
    spotL.castShadow = true;
    spotL.position.set(x, y, z);
    
    // Target for Left
    const targetL = new THREE.Object3D();
    targetL.position.set(x, 0, targetDist);
    spotL.target = targetL;
    
    headlights.add(spotL);
    headlights.add(targetL);
    
    // Right Light
    const spotR = new THREE.SpotLight(0xffffee, 10.0);
    spotR.angle = 1.0; 
    spotR.penumbra = 0.3;
    spotR.decay = 2;
    spotR.distance = 200;
    spotR.castShadow = true;
    spotR.position.set(-x, y, z);
    
    const targetR = new THREE.Object3D();
    targetR.position.set(-x, 0, targetDist);
    spotR.target = targetR;
    
    headlights.add(spotR);
    headlights.add(targetR);
    
    // Bulbs (Orbs)
    const bulbGeo = new THREE.SphereGeometry(bulbSize, 8, 8);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    
    const bulbL = new THREE.Mesh(bulbGeo, bulbMat);
    bulbL.position.copy(spotL.position);
    headlights.add(bulbL);
    
    const bulbR = new THREE.Mesh(bulbGeo, bulbMat);
    bulbR.position.copy(spotR.position);
    headlights.add(bulbR);

    // Default off
    headlights.visible = false;
    carGroup.add(headlights);
    carGroup.userData.headlights = headlights;
}

function toggleHeadlights() {
    // Check if we have an active car (Manual Driving)
    if (activeCarIndex !== -1 && cars[activeCarIndex]) {
        const car = cars[activeCarIndex];
        if (car.userData.headlights) {
            car.userData.headlights.visible = !car.userData.headlights.visible;
            // areHeadlightsOn = car.userData.headlights.visible; // Sync global state? somewhat tricky if per-car
        }
    } else {
        // Fallback or "All Toggle" if no car selected?
        // User asked for "depends on which car", so let's keep it strict to active car OR toggle all if none active.
        // Let's just toggle ALL if not racing/driving, but if driving, only toggle mine.
        if (!isRacing) {
             areHeadlightsOn = !areHeadlightsOn;
             cars.forEach(car => {
                if (car.userData.headlights) {
                    car.userData.headlights.visible = areHeadlightsOn;
                }
            });
        }
    }
}
    // Cars array populated in global scope
    // const raycaster = new THREE.Raycaster(); // Already declared globally
    // const gravity = 20.0; // Gravity strength // Already declared globally

    const loader = new GLTFLoader();
    loader.load('./map_fixed.glb', function (gltf) {
        const model = gltf.scene;
        scene.add(model);

        model.traverse((object) => {
            if (object.isMesh) {
                object.castShadow = true;
                object.receiveShadow = true;
                mapMeshes.push(object); // Add to collision list
            }
        });

        mixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach((clip) => {
            mixer.clipAction(clip).play();
        });

        document.getElementById('loading').style.display = 'none';

    }, undefined, function (error) {
        console.error(error);
        document.getElementById('loading').innerText = "ERROR LOADING FILE (Check Console)";
    });


    // Load AE86 (newly exported with applied transforms)

    
    // loader.load('./ae86.glb', function (gltf)
    loader.load('./ae86_fixed.glb', function (gltf) {
        const model = gltf.scene;
        // Fix Orientation: Model faces wrong way, so we wrap it in a group
        const carGroup = new THREE.Group();
        carGroup.add(model);
        
        // No rotation needed: User applied all transforms in Blender
        // Model should already face -Z for translateZ movement
        
        // Adjust scale on MODEL and position on GROUP
        model.scale.set(0.025, 0.025, 0.025); 
        carGroup.position.set(-40, 10, 10); 
        
        // Init velocity on GROUP
        carGroup.userData.velocity = new THREE.Vector3(0, 0, 0);
        carGroup.userData.wheels = {}; // Attach wheel storage to Group

        // Collect wheel references first (we'll create pivots after traversal)
        const collectedWheels = { fl: null, fr: null, rear: null };
        
        model.traverse((object) => {
            if (object.isMesh) {
                object.castShadow = true;
                object.receiveShadow = true;
            }
            // Collect wheels by name
            if (object.name === 'wheel_fl' || object.name.includes('wheel_fl')) {
                collectedWheels.fl = object;
                console.log('Found wheel_fl:', object.name);
            }
            if (object.name === 'wheel_fr' || object.name.includes('wheel_fr')) {
                collectedWheels.fr = object;
                console.log('Found wheel_fr:', object.name);
            }
            if (object.name === 'rear_wheels' || object.name.includes('rear_wheels')) {
                collectedWheels.rear = object;
                console.log('Found rear_wheels:', object.name);
            }
        });
        
        // Setup wheels with Dual-Pivot system to prevent Gimbal Lock
        Object.entries(collectedWheels).forEach(([key, wheelObj]) => {
            if (!wheelObj) return;
            
            console.log(`Setup ${key}: ${wheelObj.name}`);
            
            // 1. Create a Steering Pivot at the wheel's position
            const steerPivot = new THREE.Group();
            steerPivot.name = key + '_steer_pivot';
            steerPivot.position.copy(wheelObj.position);
            steerPivot.rotation.copy(wheelObj.rotation); // Match initial rotation
            
            // 2. Parent the pivot to the wheel's parent
            wheelObj.parent.add(steerPivot);
            
            // 3. Move the wheel object INSIDE the pivot
            steerPivot.add(wheelObj);
            
            // 4. Reset wheel object's local transform to 0 (since it's now relative to pivot)
            wheelObj.position.set(0, 0, 0);
            wheelObj.rotation.set(0, 0, 0);
            
            // 5. Store structure
            // - pivot: rotates Y (steer)
            // - mesh: rotates X (spin) [actually the whole wheelObj group]
            carGroup.userData.wheels[key] = {
                mesh: wheelObj,
                pivot: steerPivot
            };
            
            steerPivot.add(new THREE.AxesHelper(30)); 
        });
        
        scene.add(carGroup);
        carGroup.add(new THREE.AxesHelper(200)); 
        
        // Define rotation axes configuration for this car
        carGroup.userData.rotationSettings = {
            spinAxis: 'x',   // Rotate wheelObj around X to spin
            steerAxis: 'y'   // Rotate pivot around Y to steer
        };
        
        cars[0] = carGroup; // AE86 is always index 0
        // AE86 (Scale 1.0 group): Adjusted based on user feedback (Higher & More Forward)
        createHeadlights(carGroup, { x: 1.2, y: 1.6, z: -4.7, bulbSize: 0.1 }); 
    }, undefined, function (error) {
        console.error('Error loading AE86:', error);
    });

    loader.load('./rx7_fixed.glb', function (gltf) {
        const car = gltf.scene;
        car.scale.set(3.0, 3.0, 3.0);  
        car.position.set(-30, 10, 10); 
        
        // Init velocity and physics params
        car.userData.velocity = new THREE.Vector3(0, 0, 0);
        car.userData.groundOffset = 0.5;

        // Define rotation axes configuration for RX7
        car.userData.rotationSettings = {
            spinAxis: 'x',   // Rotate wheelObj around X to spin
            steerAxis: 'y'   // Rotate pivot around Y to steer (experiment to fix angle)
        };

        // Collect RX7 wheels first
        const collectedWheels = {};
        car.traverse((object) => {
            if (object.isMesh) {
                object.castShadow = true;
                object.receiveShadow = true;
            }
            if (object.name === 'front_left' || object.name.includes('front_left')) collectedWheels.fl = object;
            if (object.name === 'front_right' || object.name.includes('front_right')) collectedWheels.fr = object;
            if (object.name === 'rear_wheel' || object.name.includes('rear_wheel')) collectedWheels.rear = object;
        });
        
        // Apply Dual-Pivot setup to RX7 too
        car.userData.wheels = {};
        Object.entries(collectedWheels).forEach(([key, wheelObj]) => {
            // For RX7, simple setup first, but let's try consistency
            // Create a Steering Pivot at the wheel's position
            const steerPivot = new THREE.Group();
            steerPivot.name = key + '_steer_pivot';
            steerPivot.position.copy(wheelObj.position);
            steerPivot.rotation.copy(wheelObj.rotation);
            
            wheelObj.parent.add(steerPivot);
            steerPivot.add(wheelObj);
            
            wheelObj.position.set(0, 0, 0);
            wheelObj.rotation.set(0, 0, 0);
            
            car.userData.wheels[key] = {
                mesh: wheelObj,
                pivot: steerPivot
            };
             steerPivot.add(new THREE.AxesHelper(30));
        });

        scene.add(car);
        car.add(new THREE.AxesHelper(200)); 
        cars[1] = car; // RX7 is always index 1
        // RX7 (Scale 3.0): Adjusted based on user feedback
        // Desired World: x=0.75, y=0.66, z=-2.25
        // Local: x=0.25, y=0.22, z=-0.75
        createHeadlights(car, { x: 0.45, y: 0.27, z: -1.7, bulbSize: 0.03 }); 
    }, undefined, function (error) {
        console.error('Error loading RX7:', error);
    });

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.update();

    clock = new THREE.Clock();

    window.addEventListener('resize', onWindowResize);
    
    setupPathEditor();

    // Environment Buttons (Moved inside init scope)
    const btnDayNight = document.getElementById('btn-toggle-daynight');
    const btnHeadlights = document.getElementById('btn-toggle-headlights');
    const chkShadows = document.getElementById('chk-shadows');
    
    if (btnDayNight) {
        btnDayNight.addEventListener('click', toggleDayNight);
    }
    
    if (btnHeadlights) {
        btnHeadlights.addEventListener('click', toggleHeadlights);
    }
    
    if (chkShadows) {
        chkShadows.addEventListener('change', (e) => {
             renderer.shadowMap.enabled = e.target.checked;
             dirLight.castShadow = e.target.checked;
        });
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 0.1); // Cap delta to 0.1s to prevent physics tunneling
    if (mixer) mixer.update(delta);

    // Update XYZ Tracker
    const tracker = document.getElementById('tracker');
    if (tracker) {
        tracker.innerHTML = `
            <div>X: ${camera.position.x.toFixed(2)}</div>
            <div>Y: ${camera.position.y.toFixed(2)}</div>
            <div>Z: ${camera.position.z.toFixed(2)}</div>
        `;
    }

    // Race Animation logic
    if (isRacing) {
        raceTime += delta * 0.5; // Speed multiplier (adjust as needed)
        
        ['ae86', 'rx7'].forEach((name, index) => {
             const data = assignedPaths[name];
             const car = cars[index];
             
             // Ensure raceState exists
             if (!data.raceState) data.raceState = { distance: 0, speed: 0 };
             const state = data.raceState;

             if (data.curve && car) {
                 // Physics-based movement
                 // 1. Accelerate
                 state.speed = Math.min(state.speed + raceConfig.acceleration * delta, raceConfig.maxSpeed);
                 
                 // 2. Move (Distance = Speed * Time)
                 state.distance += state.speed * delta;
                 
                 // 3. Map distance to curve parameter t (0 to 1)
                 const totalLength = data.curve.getLength();
                 const t = (state.distance / totalLength) % 1.0;
                 
                 const pos = data.curve.getPointAt(t);
                 car.position.copy(pos);
                 
                 // --- Drift Math ---
                 // Get tangent (direction of path)
                 const tangent = data.curve.getTangentAt(t);
                 
                 // Calculate "curvature" by looking at difference in tangent
                 const tAhead = Math.min(t + 0.02, 0.999);
                 const tangentAhead = data.curve.getTangentAt(tAhead);
                 
                 // Cross product Y gives us which way we are turning
                 const turnDir = tangent.x * tangentAhead.z - tangent.z * tangentAhead.x;
                 
                // Drift angle: oversteer based on turn intensity
                // turnDir > 0 = turning left, < 0 = turning right
                let targetDrift = turnDir * 4.0; 
                targetDrift = Math.max(-0.8, Math.min(0.8, targetDrift)); // Clamp
                
                // SMOOTHING: Lerp current drift towards target to prevent snappy movement
                // Initialize currentDrift if missing
                if (state.currentDrift === undefined) state.currentDrift = 0;
                
                // Lerp factor (higher = faster response, lower = smoother)
                const smoothFactor = 5.0 * delta;
                state.currentDrift = THREE.MathUtils.lerp(state.currentDrift, targetDrift, smoothFactor);

                // Calculate base heading angle from tangent
                // Add PI to flip direction (car was facing backwards)
                const baseAngle = Math.atan2(tangent.x, tangent.z) + Math.PI;
                
                // Apply oversteer 
                // Use SMOOTHED drift angle
                car.rotation.y = baseAngle - state.currentDrift;
                
                // --- Wheel Animation ---
                const wheels = car.userData.wheels;
                if (wheels) {
                    const settings = car.userData.rotationSettings || { spinAxis: 'x', steerAxis: 'y' }; 
                    const wheelSpinSpeed = state.speed * 0.5 * delta; // Match visual spin to physical speed approx

                    // Spin all wheels using pivot rotation
                    // SPIN: Rotate the MESH (child)
                    if (wheels.fl && wheels.fl.mesh) wheels.fl.mesh.rotation[settings.spinAxis] += wheelSpinSpeed;
                    if (wheels.fr && wheels.fr.mesh) wheels.fr.mesh.rotation[settings.spinAxis] -= wheelSpinSpeed;
                    if (wheels.rear && wheels.rear.mesh) wheels.rear.mesh.rotation[settings.spinAxis] -= wheelSpinSpeed;
                    
                    // STEER: Rotate the PIVOT (parent)
                    // Use SMOOTHED drift angle for counter-steer too
                    const steerAngle = state.currentDrift * 0.5; 
                    if (wheels.fl && wheels.fl.pivot) wheels.fl.pivot.rotation[settings.steerAxis] = steerAngle;
                    if (wheels.fr && wheels.fr.pivot) wheels.fr.pivot.rotation[settings.steerAxis] = steerAngle;
                }
             }
        });
    }

    // Physics (Gravity) for all cars - ONLY IF NOT RACING
    if (!isRacing && cars.length > 0 && mapMeshes.length > 0) {
        cars.forEach(car => {
            const velocity = car.userData.velocity;
            
            // Apply Gravity
            velocity.y -= gravity * delta;
            car.position.addScaledVector(velocity, delta);

            // Raycast for ground collision
            // Start ray slightly above the car's feet to avoid self-collision issues if origin is at bottom
            // Assuming car origin is at bottom center:
            const rayOrigin = car.position.clone();
            rayOrigin.y += 1.0; // Lift up a bit
            raycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));

            const intersects = raycaster.intersectObjects(mapMeshes, true);
            if (intersects.length > 0) {
                const hit = intersects[0];
                const distance = hit.distance;
                
                // If hit distance is very close to 1.0 (since we lifted by 1.0), we are on ground
                // Allow small buffer
                const offset = car.userData.groundOffset || 0; // Default to 0 if not set
                // Determine threshold: 1.0 (ray lift) + offset (hover height) + 0.1 (buffer)
                const groundThreshold = 1.0 + offset + 0.1;
                
                if (distance <= groundThreshold && velocity.y <= 0) {
                    car.position.y = hit.point.y + offset;
                    velocity.y = 0;
                }
            }
            
            // Reset if fell through world (debug)
            if (car.position.y < -50) {
                // Respawn at vaguely initial coords
                // Just hardcode roughly based on which car? 
                // For simplicity, reset to sky at current X/Z or known safe spot
                car.position.y = 10;
                velocity.set(0,0,0);
            }
        });
    }

    // --- WASD Manual Driving (only when NOT racing) ---
    if (!isRacing && cars.length > 0 && cars[activeCarIndex]) {
        const car = cars[activeCarIndex]; // Control the selected car
        
        // Acceleration / Braking
        if (keys.w) {
            currentSpeed = Math.min(currentSpeed + driveConfig.acceleration * delta, driveConfig.maxSpeed);
        } else if (keys.s) {
            currentSpeed = Math.max(currentSpeed - driveConfig.acceleration * delta * 2, -driveConfig.maxSpeed * 0.5);
        } else {
            // Apply friction
            currentSpeed *= driveConfig.friction;
            if (Math.abs(currentSpeed) < 0.01) currentSpeed = 0;
        }
        
        // Steering
        let steerInput = 0;
        if (keys.a) steerInput = 1;
        if (keys.d) steerInput = -1;
        currentSteerVal = THREE.MathUtils.lerp(currentSteerVal, steerInput, 0.1);
        
        // Apply movement (Model rotated inside group, so translateZ works normally)
        if (Math.abs(currentSpeed) > 0.001) {
            car.translateZ(-currentSpeed * delta); // -Z is forward
            car.rotation.y += currentSteerVal * driveConfig.steerSpeed * delta * (currentSpeed > 0 ? 1 : -1);
        }
        

        // Animate wheels 
        // Hierarchy: Car -> SteerPivot -> WheelObj
        const wheels = car.userData.wheels;
        if (wheels) {
            const settings = car.userData.rotationSettings || { spinAxis: 'x', steerAxis: 'y' }; // Default
            const wheelRotationSpeed = currentSpeed * 5 * delta;
            
            // SPIN: Rotate the MESH (wheelObj) which is now safely inside the pivot
            if (wheels.fl && wheels.fl.mesh) wheels.fl.mesh.rotation[settings.spinAxis] += wheelRotationSpeed;
            if (wheels.fr && wheels.fr.mesh) wheels.fr.mesh.rotation[settings.spinAxis] -= wheelRotationSpeed;
            // Rear wheels don't steer, so they might not have a pivot, but structure handles it
            if (wheels.rear && wheels.rear.mesh) wheels.rear.mesh.rotation[settings.spinAxis] -= wheelRotationSpeed;
            
            // STEER: Rotate the PIVOT (parent)
            const steerAngle = currentSteerVal * 0.5;
            if (wheels.fl && wheels.fl.pivot) wheels.fl.pivot.rotation[settings.steerAxis] = steerAngle;
            if (wheels.fr && wheels.fr.pivot) wheels.fr.pivot.rotation[settings.steerAxis] = steerAngle;
        }
    }

    // --- Global Camera Logic (Runs always) ---
    // Determine which car to follow (Manual or Spectate)
    // If racing, we might not have 'activeCarIndex' set if user didn't click drive.
    // Default to index 0 if undefined/invalid during race?
    let targetCarIndex = activeCarIndex;
    if (targetCarIndex === -1 && isRacing && cars.length > 0) {
        targetCarIndex = 0; // Default to AE86 if just watching
    }

    if (cars.length > 0 && cars[targetCarIndex]) {
        const car = cars[targetCarIndex]; 
        
        // 1. Update Controls Target
        if (controls) controls.target.copy(car.position);

        // 2. Camera Positioning Logic
        if (!window.isFreeCamActive) {
            
            let customCameraActive = false;
            
            // Playback Update - Run BEFORE checking active camera
            if (CameraRecorder && CameraRecorder.isPlaying && isRacing) {
                 CameraRecorder.update(raceTime);
            }
            
            // Recording: Log angle changes
            if (CameraRecorder && CameraRecorder.isRecording && isRacing) {
                 CameraRecorder.logAngles();
            }

            if (window.activeCameraName && car.userData.cameras) {
                 
                const camData = car.userData.cameras.find(c => c.name === window.activeCameraName);
                if (camData) {
                    customCameraActive = true;
                    
                    const worldPos = camData.offset.clone().applyQuaternion(car.quaternion).add(car.position);
                    const worldRot = car.quaternion.clone().multiply(camData.rotation);
                    
                    camera.position.copy(worldPos);
                    camera.quaternion.copy(worldRot);
                    
                    // Apply pitch/yaw/roll adjustments to custom camera too
                    const pitchRad = THREE.MathUtils.degToRad(window.cameraPitch || 0);
                    const yawRad = THREE.MathUtils.degToRad(window.cameraYaw || 0);
                    const rollRad = THREE.MathUtils.degToRad(window.cameraRoll || 0);
                    
                    // Apply rotations in order: yaw (Y), pitch (X), roll (Z)
                    camera.rotateY(yawRad);
                    camera.rotateX(pitchRad);
                    camera.rotateZ(rollRad);
                }
            }
            
            if (!customCameraActive) {
                // Default Chase Camera with Pitch/Yaw/Roll control
                const pitchRad = THREE.MathUtils.degToRad(window.cameraPitch || 0);
                const yawRad = THREE.MathUtils.degToRad(window.cameraYaw || 0);
                const rollRad = THREE.MathUtils.degToRad(window.cameraRoll || 0);
                
                // Base offset: behind and above the car
                const distance = 10;
                const baseHeight = 5;
                
                // Calculate offset using spherical coordinates relative to car
                // Yaw rotates around Y axis, Pitch tilts up/down
                const offsetX = Math.sin(yawRad) * distance;
                const offsetZ = Math.cos(yawRad) * distance;
                const offsetY = baseHeight + Math.sin(pitchRad) * distance;
                
                const relativeOffset = new THREE.Vector3(offsetX, offsetY, offsetZ);
                const cameraOffset = relativeOffset.applyMatrix4(car.matrixWorld);
                camera.position.lerp(cameraOffset, 0.1);
                camera.lookAt(car.position);
                
                // Apply roll rotation around the camera's forward (Z) axis
                camera.rotateZ(rollRad);
            }
        }
    }
    if (mapMeshes.length > 0) {
        const floorRaycaster = new THREE.Raycaster();
        // Start ray from above the camera to detect terrain height
        const rayOrigin = new THREE.Vector3(camera.position.x, camera.position.y + 10, camera.position.z);
        floorRaycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));

        const intersects = floorRaycaster.intersectObjects(mapMeshes, true);
        if (intersects.length > 0) {
            const groundHeight = intersects[0].point.y;
            const minHeight = 1.2; // Distance to stay above ground

            // If the camera falls below the ground, push it back up smoothly
            if (camera.position.y < groundHeight + minHeight) {
                camera.position.y = groundHeight + minHeight;
            }
        }
    }
    renderer.render(scene, camera);
}



    // --- Path Editor Buttons ---

function assignPath(carName, color) {
    if (waypoints.length < 2) {
        alert("Draw a path with at least 2 points first!");
        return;
    }

    // Deep copy points
    const points = waypoints.map(wp => wp.position.clone());
    const curve = new THREE.CatmullRomCurve3(points);
    
    // Create visual line for assigned path
    const curvePoints = curve.getPoints(200);
    const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const material = new THREE.LineBasicMaterial({ color: color, linewidth: 4 });
    const line = new THREE.Line(geometry, material);
    
    // Remove old assignment if exists
    if (assignedPaths[carName].line) {
        scene.remove(assignedPaths[carName].line);
    }
    
    scene.add(line);
    assignedPaths[carName] = { curve, line, points };
    
    // Teleport car to start
    const carIndex = carName === 'ae86' ? 0 : 1;
    if (cars[carIndex]) {
        const startPoint = curve.getPointAt(0);
        cars[carIndex].position.copy(startPoint);
        cars[carIndex].lookAt(curve.getPointAt(0.01));
        // Reset physics velocity so it doesn't fall through floor if paused
        cars[carIndex].userData.velocity.set(0,0,0);
    }
    
    alert(`Path assigned to ${carName.toUpperCase()}!`);
}

// --- Race Logic ---
const raceConfig = {
    acceleration: 10.0, // Units per second^2
    maxSpeed: 40.0     // Units per second
};

function startRace() {
    if (!assignedPaths.ae86.curve && !assignedPaths.rx7.curve) {
        alert("Assign paths to cars first!");
        return;
    }
    isRacing = true;
    raceTime = 0;
    
    // Initialize Race State for each car
    ['ae86', 'rx7'].forEach(key => {
        if (assignedPaths[key].points) {
            assignedPaths[key].raceState = {
                distance: 0,
                speed: 0
            };
        }
    });
}

function resetRace() {
    isRacing = false;
    raceTime = 0;
    // Teleport back to start
    ['ae86', 'rx7'].forEach((name, index) => {
        if (assignedPaths[name].curve && cars[index]) {
             const startPoint = assignedPaths[name].curve.getPointAt(0);
             cars[index].position.copy(startPoint);
             cars[index].lookAt(assignedPaths[name].curve.getPointAt(0.01));
             // Reset physics state
             assignedPaths[name].raceState = { distance: 0, speed: 0 };
        }
    });
}

function saveState() {
    const currentState = waypoints.map(wp => wp.position.clone());
    undoStack.push(currentState);
    // Limit stack size if needed, but for now infinite is fine-ish
    redoStack.length = 0; // Clear redo stack on new action
}

function restoreState(state) {
    // Clear current scene objects
    waypoints.forEach(wp => scene.remove(wp));
    waypoints.length = 0;
    waypointObjects.length = 0;
    
    // Recreate from state
    state.forEach(pos => {
        addWaypoint(pos, false); // false = don't save state again
    });
    
    updateCurve();
}

function undo() {
    if (undoStack.length === 0) return;
    
    // Save current state to redo stack
    const currentState = waypoints.map(wp => wp.position.clone());
    redoStack.push(currentState);
    
    // Pop previous state
    const previousState = undoStack.pop();
    restoreState(previousState);
}

function redo() {
    if (redoStack.length === 0) return;
    
    // Save current state to undo stack
    const currentState = waypoints.map(wp => wp.position.clone());
    undoStack.push(currentState);
    
    // Pop next state
    const nextState = redoStack.pop();
    restoreState(nextState);
}

// --- Path Manager State ---
let storedPaths = []; // Array of { name: str, points: [vec3], isClosed: bool }
let selectedPathIndex = -1;

function setupPathEditor() {
    const btnToggle = document.getElementById('btn-toggle-editor');
    // Path Manager Buttons
    const btnSave = document.getElementById('btn-save-path');
    const btnLoad = document.getElementById('btn-load-path');
    const fileInput = document.getElementById('file-input');
    const btnAssignAE86 = document.getElementById('btn-assign-ae86');
    const btnAssignRX7 = document.getElementById('btn-assign-rx7');
    const btnPlay = document.getElementById('btn-play-race');
    const btnReset = document.getElementById('btn-reset-race');
    
    // Editor controls (if still present in UI)
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    const btnClear = document.getElementById('btn-clear-path');
    const btnCloseLoop = document.getElementById('btn-close-loop');
    
    // List Container
    const pathListContainer = document.getElementById('path-list');

    if (!btnToggle) return;

    btnToggle.addEventListener('click', () => {
        isEditorEnabled = !isEditorEnabled;
        btnToggle.classList.toggle('active');
        btnToggle.innerText = isEditorEnabled ? "Stop Adding Points" : "Add Points";
    });

    if(btnUndo) btnUndo.addEventListener('click', undo);
    if(btnRedo) btnRedo.addEventListener('click', redo);
    
    if(btnCloseLoop) {
        btnCloseLoop.addEventListener('click', () => {
            if (waypoints.length < 3) {
                alert("Need at least 3 points to close a loop!");
                return;
            }
            saveState();
            window.forceClosedLoop = true;
            updateCurve();
            alert("Loop closed! The path now forms a seamless loop.");
        });
    }

    // --- Race Settings Sliders ---
    const raceMaxSpeedSlider = document.getElementById('race-max-speed');
    const raceAccelSlider = document.getElementById('race-acceleration');
    const speedValueLabel = document.getElementById('speed-value');
    const accelValueLabel = document.getElementById('accel-value');
    
    if (raceMaxSpeedSlider) {
        raceMaxSpeedSlider.addEventListener('input', () => {
            raceConfig.maxSpeed = parseFloat(raceMaxSpeedSlider.value);
            if (speedValueLabel) speedValueLabel.textContent = raceMaxSpeedSlider.value;
        });
    }
    
    if (raceAccelSlider) {
        raceAccelSlider.addEventListener('input', () => {
            raceConfig.acceleration = parseFloat(raceAccelSlider.value);
            if (accelValueLabel) accelValueLabel.textContent = raceAccelSlider.value;
        });
    }

    // --- Hide UI Logic ---
    const btnHideUI = document.getElementById('btn-hide-ui');
    let uiHidden = false;
    
    function toggleUI() {
        uiHidden = !uiHidden;
        const uiElements = [
            document.getElementById('path-manager'),
            document.getElementById('env-controls'),
            document.getElementById('camera-manager'),
            document.getElementById('editor-controls'),
            document.getElementById('tracker')
        ];
        
        uiElements.forEach(el => {
            if (el) el.style.display = uiHidden ? 'none' : '';
        });
        
        if (btnHideUI) {
            btnHideUI.textContent = uiHidden ? 'Show UI (H)' : 'Hide UI (H)';
            btnHideUI.style.opacity = uiHidden ? '0.3' : '1';
        }
    }
    
    if (btnHideUI) {
        btnHideUI.addEventListener('click', toggleUI);
    }
    
    // H key to toggle UI
    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'h' && !e.target.matches('input, textarea')) {
            toggleUI();
        }
    });

    // --- Path Manager Logic ---
    
    let previewLine = null;
    let editingPathIndex = -1; // Index of path currently being edited

    function previewPath(index) {
        // Remove previous preview
        if (previewLine) {
            scene.remove(previewLine);
            previewLine.geometry.dispose();
            previewLine.material.dispose();
            previewLine = null;
        }

        if (index === -1 || !storedPaths[index]) return;

        const pathData = storedPaths[index];
        const points = pathData.points.map(p => new THREE.Vector3(p.x, p.y, p.z));

        // Create visual representation
        let geometry;
        if (pathData.isClosed) {
             const curve = new THREE.CatmullRomCurve3(points, true);
             const spacedPoints = curve.getPoints(200);
             geometry = new THREE.BufferGeometry().setFromPoints(spacedPoints);
        } else {
             const curve = new THREE.CatmullRomCurve3(points, false);
             const spacedPoints = curve.getPoints(200);
             geometry = new THREE.BufferGeometry().setFromPoints(spacedPoints);
        }

        const material = new THREE.LineBasicMaterial({ color: 0x00ffff, opacity: 0.7, transparent: true }); // Cyan preview
        previewLine = new THREE.Line(geometry, material);
        scene.add(previewLine);
    }

    function renderPathList() {
        if (!pathListContainer) return;
        pathListContainer.innerHTML = '';
        if (storedPaths.length === 0) {
            pathListContainer.innerHTML = '<div style="color: #666; font-style: italic; text-align: center; padding-top: 20px;">No paths loaded</div>';
            return;
        }

        storedPaths.forEach((path, index) => {
            const div = document.createElement('div');
            
            // Highlight logic
            if (index === selectedPathIndex) {
                 div.style.background = '#4CAF50';
                 div.style.color = '#fff';
            } else {
                 div.style.background = '#333';
                 div.style.color = '#ccc';
            }
            // Indicate if currently editing this index
            if (index === editingPathIndex) {
                div.innerText = `[EDITING] ${path.name} (${path.points.length} pts)`;
                div.style.border = "1px solid yellow";
            } else {
                div.innerText = `${path.name} (${path.points.length} pts)`;
            }
            
            div.style.padding = '5px';
            div.style.marginBottom = '2px';
            div.style.cursor = 'pointer';
            div.style.userSelect = 'none'; // Prevent text selection
            div.style.webkitUserSelect = 'none';
            div.style.mozUserSelect = 'none';
            div.style.msUserSelect = 'none';
            
            div.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // CRITICAL: Prevent window click from immediately deselecting
                console.log('Clicked path:', index, path.name);
                selectedPathIndex = index;
                renderPathList();
                previewPath(index); // Show preview line
            });
            
            // Double-click to rename
            div.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Create inline input for editing
                const input = document.createElement('input');
                input.type = 'text';
                input.value = path.name;
                input.style.width = '100%';
                input.style.padding = '4px';
                input.style.boxSizing = 'border-box';
                input.style.background = '#222';
                input.style.color = '#fff';
                input.style.border = '1px solid #4CAF50';
                input.style.outline = 'none';
                
                div.innerHTML = '';
                div.appendChild(input);
                input.focus();
                input.select();
                
                const finishEdit = () => {
                    const newName = input.value.trim();
                    if (newName && newName !== path.name) {
                        storedPaths[index].name = newName;
                        console.log('Renamed path to:', newName);
                    }
                    renderPathList();
                };
                
                input.addEventListener('blur', finishEdit);
                input.addEventListener('keydown', (ke) => {
                    if (ke.key === 'Enter') {
                        ke.preventDefault();
                        input.blur();
                    } else if (ke.key === 'Escape') {
                        ke.preventDefault();
                        renderPathList(); // Cancel without saving
                    }
                });
            });
            
            pathListContainer.appendChild(div);
        });
    }

    // Call it right away just in case
    renderPathList();

    // Deselect if clicking outside the ENTIRE Path Manager
    const pathManagerDiv = document.getElementById('path-manager');
    window.addEventListener('click', (e) => {
        // Only deselect if clicking COMPLETELY outside the path manager panel
        if (pathManagerDiv && !pathManagerDiv.contains(e.target)) {
             if (selectedPathIndex !== -1) {
                 selectedPathIndex = -1;
                 renderPathList();
                 previewPath(-1); // Clear preview
             }
        }
    });

    // NEW: Edit Selected Button Logic
    const btnEdit = document.getElementById('btn-edit-path');
    if (btnEdit) {
        btnEdit.addEventListener('click', () => {
            if (selectedPathIndex === -1) {
                alert("Please select a path from the list first!");
                return;
            }
            
            const pathData = storedPaths[selectedPathIndex];
            if (!confirm(`Load "${pathData.name}" into Editor? Current unsaved points will be lost.`)) return;
            
            // Clear current editor
            waypoints.forEach(wp => scene.remove(wp));
            waypoints.length = 0;
            waypointObjects.length = 0;
            
            // Load points
            pathData.points.forEach(p => {
                const vec = new THREE.Vector3(p.x, p.y, p.z);
                addWaypoint(vec, false);
            });
            
            // Restore closed state if applicable
            window.forceClosedLoop = pathData.isClosed;
            
            updateCurve();
            
            // Set Editing State
            editingPathIndex = selectedPathIndex;
            renderPathList(); // Update UI to show [EDITING] status
            
            alert(`Loaded "${pathData.name}". You can now Add/Move/Remove points. Click "Save" when done to Overwrite or Save New.`);
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', () => {
             if (waypoints.length < 2) {
                 alert("Create a path with at least 2 points first!");
                 return;
             }
             
             // Check if we are editing an existing path
             if (editingPathIndex !== -1) {
                 const originalName = storedPaths[editingPathIndex].name;
                 if (confirm(`Overwrite "${originalName}" with these changes?\nCancel to save as a NEW path.`)) {
                     // OVERWRITE
                     storedPaths[editingPathIndex] = {
                         name: originalName,
                         points: waypoints.map(wp => ({x: wp.position.x, y: wp.position.y, z: wp.position.z})),
                         isClosed: !!window.forceClosedLoop
                     };
                     alert(`Updated "${originalName}"!`);
                     editingPathIndex = -1; // Reset editing state
                     renderPathList();
                     return;
                 }
             }

             // SAVE AS NEW
             const name = prompt("Enter path name:", "My Path " + (storedPaths.length + 1));
             if (name) {
                 const saveData = {
                    points: waypoints.map(wp => ({x: wp.position.x, y: wp.position.y, z: wp.position.z})),
                    isClosed: !!window.forceClosedLoop
                 };

                 storedPaths.push({
                     name: name,
                     points: saveData.points,
                     isClosed: saveData.isClosed
                 });
                 renderPathList();
                 // If we were editing but chose "Cancel" (Save New), we should probably exit edit mode too, 
                 // or stay? Usually saving as new means we are done with the old one.
                 editingPathIndex = -1; 
                 renderPathList();

                 // Also download file
                const jsonStr = JSON.stringify(saveData, null, 2);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = name.replace(/\s+/g, '_') + '.json';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
             }
        });
    }



    // Load Path: Reads file(s) and adds to storedPaths list
    btnLoad.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        
        let loadedCount = 0;
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const saveData = JSON.parse(event.target.result);
                    const points = Array.isArray(saveData) ? saveData : saveData.points;
                    const isClosed = saveData.isClosed || false;
                    
                    storedPaths.push({
                        name: file.name.replace('.json', ''),
                        points: points,
                        isClosed: isClosed
                    });
                    
                    loadedCount++;
                    if (loadedCount === files.length) {
                         renderPathList();
                         alert(`Loaded ${loadedCount} path(s)!`);
                    }
                } catch (err) {
                    console.error("Error loading file:", file.name, err);
                }
            };
            reader.readAsText(file);
        });
        fileInput.value = ''; // Reset
    });

    // Assign Buttons
    btnAssignAE86.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedPathIndex === -1) {
            alert("Select a path from the list first!");
            return;
        }
        assignPathFromData('ae86', storedPaths[selectedPathIndex], 0x00ffff);
    });
    
    btnAssignRX7.addEventListener('click', (e) => {
         e.stopPropagation();
        if (selectedPathIndex === -1) {
            alert("Select a path from the list first!");
            return;
        }
        assignPathFromData('rx7', storedPaths[selectedPathIndex], 0xffa500);
    });

    // --- Helper to assign from stored data (different from assigning from current editor) ---
    function assignPathFromData(carName, pathData, color) {
        // Create curve from stored points
        const points = pathData.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
        const curve = new THREE.CatmullRomCurve3(points);
        curve.closed = pathData.isClosed;
        
        // Visual Line
        const curvePoints = curve.getPoints(200);
        const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
        const material = new THREE.LineBasicMaterial({ color: color, linewidth: 4 });
        const line = new THREE.Line(geometry, material);
        
        if (assignedPaths[carName].line) scene.remove(assignedPaths[carName].line);
        scene.add(line);
        
        assignedPaths[carName] = { curve, line, points };
        
        // Teleport
        const carIndex = carName === 'ae86' ? 0 : 1;
        if (cars[carIndex]) {
            cars[carIndex].position.copy(curve.getPointAt(0));
            cars[carIndex].lookAt(curve.getPointAt(0.01));
            cars[carIndex].userData.velocity.set(0,0,0);
        }
        console.log(`Assigned "${pathData.name}" to ${carName}`);
    }

    // --- Deassign Logic ---
    function deassignPath(carName) {
        if (assignedPaths[carName].line) {
            scene.remove(assignedPaths[carName].line);
        }
        
        assignedPaths[carName] = { curve: null, line: null, points: [] };
        
        // Reset car position? (Optional, maybe just stop racing)
        // Let's reset race state
        if (assignedPaths[carName].raceState) assignedPaths[carName].raceState = null;
        
        console.log(`Deassigned path from ${carName}`);
    }
    
    // Bind Deassign Buttons
    const btnDeassignAE86 = document.getElementById('btn-deassign-ae86');
    const btnDeassignRX7 = document.getElementById('btn-deassign-rx7');
    
    if (btnDeassignAE86) btnDeassignAE86.addEventListener('click', (e) => { e.stopPropagation(); deassignPath('ae86'); });
    if (btnDeassignRX7) btnDeassignRX7.addEventListener('click', (e) => { e.stopPropagation(); deassignPath('rx7'); });

    // --- Car Drive/Race Buttons ---
    const btnDriveAE86 = document.getElementById('btn-drive-ae86');
    const btnDriveRX7 = document.getElementById('btn-drive-rx7');
    
    if (btnDriveAE86) {
        btnDriveAE86.addEventListener('click', () => {
            if (activeCarIndex === 0) {
                // Toggle OFF
                activeCarIndex = -1;
                btnDriveAE86.style.border = 'none';
                console.log('Stopped driving: AE86');
            } else {
                // Toggle ON
                activeCarIndex = 0;
                currentSpeed = 0; 
                btnDriveAE86.style.border = '2px solid white';
                if (btnDriveRX7) btnDriveRX7.style.border = 'none';
                console.log('Now driving: AE86');
            }
            if (window.updateCameraManagerUI) window.updateCameraManagerUI();
        });
    }
    if (btnDriveRX7) {
        btnDriveRX7.addEventListener('click', () => {
             if (activeCarIndex === 1) {
                // Toggle OFF
                activeCarIndex = -1;
                btnDriveRX7.style.border = 'none';
                console.log('Stopped driving: RX7');
            } else {
                // Toggle ON
                activeCarIndex = 1;
                currentSpeed = 0;
                btnDriveRX7.style.border = '2px solid white';
                if (btnDriveAE86) btnDriveAE86.style.border = 'none';
                console.log('Now driving: RX7');
            }
            if (window.updateCameraManagerUI) window.updateCameraManagerUI();
        });
    }

    btnPlay.addEventListener('click', startRace);
    btnReset.addEventListener('click', resetRace);

    if (btnClear) {
        btnClear.addEventListener('click', () => {
             saveState(); 
             waypoints.forEach(wp => scene.remove(wp));
             waypoints.length = 0;
             waypointObjects.length = 0;
             if (curveLine) {
                 scene.remove(curveLine);
                 curveLine = null;
             }
        });
    }

    // Drag Controls Init
    dragControls = new DragControls(waypointObjects, camera, renderer.domElement);
    dragControls.addEventListener('dragstart', function (event) { 
        saveState(); 
        controls.enabled = false; 
    });
    dragControls.addEventListener('dragend', function (event) {
        controls.enabled = true; 
        if (waypoints.length > 2) {
            const first = waypoints[0];
            const last = waypoints[waypoints.length - 1];
            if (event.object === last) {
                 if (first.position.distanceTo(last.position) < 3.0) {
                     last.position.copy(first.position);
                     updateCurve(); 
                 }
            }
        }
    });
    dragControls.addEventListener('drag', function (event) {
        const wp = event.object;
        const rayOrigin = wp.position.clone();
        rayOrigin.y += 50; 
        const groundRaycaster = new THREE.Raycaster();
        groundRaycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
        const intersects = groundRaycaster.intersectObjects(mapMeshes, true);
        if (intersects.length > 0) wp.position.y = intersects[0].point.y + 0.5; 
        updateCurve();
    });
    
    // --- Camera Manager Logic ---
    const cameraManager = document.getElementById('camera-manager');
    const cameraList = document.getElementById('camera-list');
    const cameraNameInput = document.getElementById('camera-name-input');
    const btnSaveCamera = document.getElementById('btn-save-camera');
    const btnOverwriteCamera = document.getElementById('btn-overwrite-camera');
    const btnToggleFreeCam = document.getElementById('btn-toggle-freecam'); // NEW
    
    let activeCameraName = null; // Name of currently selected camera
    let isFreeCamActive = false; // NEW

    function updateCameraManagerUI() {
        // Sync global state for animate loop logic
        window.activeCameraName = activeCameraName;
        
        // Expose helper to allow replay to update local state
        window.setActiveCamera = (name) => {
            if (activeCameraName !== name) {
                activeCameraName = name;
                updateCameraManagerUI();
            }
        };

        if (!cameraManager || activeCarIndex === -1) {
            if (cameraManager) cameraManager.style.display = 'none';
            return;
        }
        
        const car = cars[activeCarIndex];
        if (!car) return;

        cameraManager.style.display = 'block';
        cameraList.innerHTML = '';
        
        // Ensure cameras array exists
        if (!car.userData.cameras) car.userData.cameras = [];
        
        // Add "Default Chase" option
        const defaultDiv = document.createElement('div');
        defaultDiv.textContent = "Default Chase";
        defaultDiv.style.padding = '5px';
        defaultDiv.style.cursor = 'pointer';
        defaultDiv.style.background = (activeCameraName === null) ? '#2196F3' : 'transparent';
        defaultDiv.addEventListener('click', () => {
            activeCameraName = null;
            updateCameraManagerUI();
        });
        cameraList.appendChild(defaultDiv);

        // List Saved Cameras
        car.userData.cameras.forEach((cam, index) => {
            const div = document.createElement('div');
            div.textContent = cam.name;
            div.style.padding = '5px';
            div.style.cursor = 'pointer';
            div.style.background = (activeCameraName === cam.name) ? '#2196F3' : 'transparent';
            
            div.addEventListener('click', () => {
                activeCameraName = cam.name;
                cameraNameInput.value = cam.name;
                updateCameraManagerUI();
            });
            
            cameraList.appendChild(div);
        });
        
        // Show/Hide Overwrite Button
        if (activeCameraName && activeCameraName !== 'Default Chase') {
            btnOverwriteCamera.style.display = 'block';
            btnOverwriteCamera.textContent = `Overwrite "${activeCameraName}"`;
        } else {
            btnOverwriteCamera.style.display = 'none';
        }
        
        // Reset free cam state when switching cameras? Maybe good idea.
        // Actually, user might want to free cam FROM a start point. 
        // But for now let's keep it independent toggle.
    }
    
    // Toggle Free Cam
    if (btnToggleFreeCam) {
        btnToggleFreeCam.addEventListener('click', () => {
            isFreeCamActive = !isFreeCamActive;
            btnToggleFreeCam.textContent = isFreeCamActive ? "Disable Free Cam" : "Enable Free Cam";
            btnToggleFreeCam.style.background = isFreeCamActive ? "#f44336" : "#9c27b0";
            
            // Expose state to window for animate loop
            window.isFreeCamActive = isFreeCamActive;
        });
    }

    // Camera Pitch/Yaw/Roll Controls
    const cameraPitchSlider = document.getElementById('camera-pitch');
    const cameraYawSlider = document.getElementById('camera-yaw');
    const cameraRollSlider = document.getElementById('camera-roll');
    const pitchValueLabel = document.getElementById('pitch-value');
    const yawValueLabel = document.getElementById('yaw-value');
    const rollValueLabel = document.getElementById('roll-value');
    const btnResetAngles = document.getElementById('btn-reset-camera-angles');
    
    // Initialize global values
    window.cameraPitch = 0;
    window.cameraYaw = 0;
    window.cameraRoll = 0;
    
    if (cameraPitchSlider) {
        cameraPitchSlider.addEventListener('input', () => {
            window.cameraPitch = parseFloat(cameraPitchSlider.value);
            if (pitchValueLabel) pitchValueLabel.textContent = cameraPitchSlider.value;
        });
    }
    
    if (cameraYawSlider) {
        cameraYawSlider.addEventListener('input', () => {
            window.cameraYaw = parseFloat(cameraYawSlider.value);
            if (yawValueLabel) yawValueLabel.textContent = cameraYawSlider.value;
        });
    }
    
    if (cameraRollSlider) {
        cameraRollSlider.addEventListener('input', () => {
            window.cameraRoll = parseFloat(cameraRollSlider.value);
            if (rollValueLabel) rollValueLabel.textContent = cameraRollSlider.value;
        });
    }
    
    if (btnResetAngles) {
        btnResetAngles.addEventListener('click', () => {
            window.cameraPitch = 0;
            window.cameraYaw = 0;
            window.cameraRoll = 0;
            if (cameraPitchSlider) cameraPitchSlider.value = 0;
            if (cameraYawSlider) cameraYawSlider.value = 0;
            if (cameraRollSlider) cameraRollSlider.value = 0;
            if (pitchValueLabel) pitchValueLabel.textContent = '0';
            if (yawValueLabel) yawValueLabel.textContent = '0';
            if (rollValueLabel) rollValueLabel.textContent = '0';
        });
    }

    // Hook into Drive Toggles to show/hide UI
    // We do this by checking activeCarIndex in the loop or adding a callback
    // For simplicity, let's call updateCameraManagerUI() inside the button listeners
    
    // Save Camera
    btnSaveCamera.addEventListener('click', () => {
        if (activeCarIndex === -1) return;
        const car = cars[activeCarIndex];
        const name = cameraNameInput.value.trim() || `Camera ${car.userData.cameras.length + 1}`;
        
        // CHECK FOR DUPLICATES
        if (car.userData.cameras.some(c => c.name === name)) {
            alert(`Camera "${name}" already exists!\nUse "Overwrite Selected" to update it, or choose a new name.`);
            return;
        }

        // Calculate Relative Offset
        // Relative Pos = (CameraPos - CarPos) rotated by InverseCarQuat
        const relativePos = camera.position.clone().sub(car.position);
        relativePos.applyQuaternion(car.quaternion.clone().invert());
        
        // Relative Rot = InverseCarQuat * CameraQuat
        const relativeRot = car.quaternion.clone().invert().multiply(camera.quaternion);
        
        const newCam = {
            name: name,
            offset: relativePos,
            rotation: relativeRot
        };
        
        car.userData.cameras.push(newCam);
        activeCameraName = name;
        updateCameraManagerUI();
        // alert(`Saved camera: ${name}`); // Optional: Remove alert to be less annoying? Or keep it. Keep for now.
    });
    
    // Overwrite Camera
    btnOverwriteCamera.addEventListener('click', () => {
        if (activeCarIndex === -1 || !activeCameraName) return;
        const car = cars[activeCarIndex];
        
        const index = car.userData.cameras.findIndex(c => c.name === activeCameraName);
        if (index !== -1) {
            const relativePos = camera.position.clone().sub(car.position);
            relativePos.applyQuaternion(car.quaternion.clone().invert());
            const relativeRot = car.quaternion.clone().invert().multiply(camera.quaternion);
            
            car.userData.cameras[index].offset = relativePos;
            car.userData.cameras[index].rotation = relativeRot;
            
            // Rename if input changed
            if (cameraNameInput.value.trim() && cameraNameInput.value.trim() !== activeCameraName) {
                car.userData.cameras[index].name = cameraNameInput.value.trim();
                activeCameraName = car.userData.cameras[index].name;
            }
            
            updateCameraManagerUI();
            alert(`Overwritten camera: ${activeCameraName}`);
        }
    });

    // We need to export this function or attach it to window so we can call it from the button listeners
    window.updateCameraManagerUI = updateCameraManagerUI;
    
    // Call it initially 
    updateCameraManagerUI();

    window.addEventListener('mousedown', onMouseDown);
}

// Global variable for camera update logic (should be in window or top scope)
// We rely on window properties for simplicity here


// New Helper to update camera position in animate loop
function updateActiveCamera() {
    if (activeCarIndex === -1) return;
    const car = cars[activeCarIndex];
    
    // Check if using a custom camera
    // We need to access the activeCameraName from the closure inside setupPathEditor...
    // Scope Issue: activeCameraName is defined inside setupPathEditor. 
    // Let's make it global or accessible.
    // Done: moved `activeCameraName` to setupPathEditor but exposed a getter? 
    // Actually, `activeCameraName` inside `setupPathEditor` is local.
    // Let's assume we access car.userData.activeCameraName (we can store state on car)
    
    // Better: Allow setupPathEditor to set a global `currentCameraMode` object
}


function onMouseDown(event) {
    if (!isEditorEnabled) return;
    // Don't add point if clicking on UI
    if (event.target.closest('button')) return;

    // Use a Raycaster to find where on map to place point
    // We reuse the global raycaster if possible, or new one
    const mouse = new THREE.Vector2();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    const editorRaycaster = new THREE.Raycaster();
    editorRaycaster.setFromCamera(mouse, camera);

    // Check if we hit existing waypoint? (DragControls should intercept first if active, but let's be safe)
    // If we click on a waypoint, DragControls (which is always active now) handles it.
    // However, onMouseDown also fires. We should avoid adding a point if we clicked a waypoint.
    const hitWaypoint = editorRaycaster.intersectObjects(waypointObjects);
    if (hitWaypoint.length > 0) return; 

    // Raycast to Ground (mapMeshes)
    const intersects = editorRaycaster.intersectObjects(mapMeshes, true);
    if (intersects.length > 0) {
        // Add new waypoint at hit point
        addWaypoint(intersects[0].point);
    }
}

function addWaypoint(position, recordState = true) {
    if (recordState) saveState();

    const geometry = new THREE.SphereGeometry(0.5, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const sphere = new THREE.Mesh(geometry, material);
    
    sphere.position.copy(position);
    sphere.position.y += 0.5; // Lift slightly
    
    scene.add(sphere);
    waypoints.push(sphere);
    waypointObjects.push(sphere);
    
    updateCurve();
}

function updateCurve() {
    if (waypoints.length < 2) return;

    if (curveLine) {
        scene.remove(curveLine);
    }

    const points = waypoints.map(wp => wp.position);
    
    // Check if closed (either by distance or by user forcing close)
    const isClosed = window.forceClosedLoop || (points.length > 2 && points[0].distanceTo(points[points.length - 1]) < 0.1);
    
    const curve = new THREE.CatmullRomCurve3(points, isClosed);
    
    const curvePoints = curve.getPoints(200);
    const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const material = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
    
    curveLine = new THREE.Line(geometry, material);
    scene.add(curveLine);
}

// --- Camera Recorder & Persistence Logic ---

const CameraRecorder = {
    isRecording: false,
    isPlaying: false,
    keyframes: [], // Array of { time: float, cameraName: string }
    
    startRecording: function() {
        this.isRecording = true;
        this.isPlaying = false;
        this.keyframes = [];
        
        // Record initial state
        this.logSwitch(window.activeCameraName || "Default Chase");
        
        console.log("Started Recording Camera...");
        const btn = document.getElementById('btn-record-camera');
        if(btn) {
            btn.textContent = "Stop & Save";
            btn.style.background = "#f44336";
        }
    },
    
    stopRecording: function() {
        this.isRecording = false;
        console.log("Stopped Recording. Keyframes:", this.keyframes.length);
        
        const btn = document.getElementById('btn-record-camera');
        if(btn) {
            btn.textContent = "Start Record";
            btn.style.background = "#e91e63";
        }
        
        this.exportReplay(); // Auto-save replay on stop? Or user manual? User manual is safer but usually user wants it. 
        // User asked to separate them. Let's AUTO download replay since that's what we just recorded.
    },
    
    logSwitch: function(cameraName) {
        if (!this.isRecording) return;
        
        const time = isRacing ? raceTime : 0; 
        
        this.keyframes.push({
            time: time,
            cameraName: cameraName,
            pitch: window.cameraPitch || 0,
            yaw: window.cameraYaw || 0,
            roll: window.cameraRoll || 0
        });
        console.log(`Recorded switch to "${cameraName}" at ${time.toFixed(2)}s (P:${window.cameraPitch}, Y:${window.cameraYaw}, R:${window.cameraRoll})`);
    },
    
    // Call this periodically during recording to capture angle changes
    logAngles: function() {
        if (!this.isRecording) return;
        
        const time = isRacing ? raceTime : 0;
        const lastKf = this.keyframes[this.keyframes.length - 1];
        
        // Only log if angles changed significantly (avoid spam)
        if (lastKf && 
            Math.abs(lastKf.pitch - (window.cameraPitch || 0)) < 0.5 &&
            Math.abs(lastKf.yaw - (window.cameraYaw || 0)) < 0.5 &&
            Math.abs(lastKf.roll - (window.cameraRoll || 0)) < 0.5) {
            return; // No significant change
        }
        
        this.keyframes.push({
            time: time,
            cameraName: window.activeCameraName || "Default Chase",
            pitch: window.cameraPitch || 0,
            yaw: window.cameraYaw || 0,
            roll: window.cameraRoll || 0
        });
    },
    
    update: function(time) {
        if (!this.isPlaying || this.keyframes.length === 0) return;
        
        let activeKey = null;
        for (let i = 0; i < this.keyframes.length; i++) {
            if (this.keyframes[i].time <= time) {
                activeKey = this.keyframes[i];
            } else {
                break; 
            }
        }
        
        if (activeKey) {
             if (window.activeCameraName !== activeKey.cameraName) {
                 console.log(`Replay: Switching to ${activeKey.cameraName} at ${time.toFixed(2)}`);
                 
                 // Use the helper to sync local scope and UI
                 if (window.setActiveCamera) {
                     window.setActiveCamera(activeKey.cameraName);
                 } else {
                     // Fallback if helper missing (shouldn't happen)
                     window.activeCameraName = activeKey.cameraName;
                     if (window.updateCameraManagerUI) window.updateCameraManagerUI();
                 }
             }
             
             // Restore pitch/yaw/roll values
             if (activeKey.pitch !== undefined) {
                 window.cameraPitch = activeKey.pitch;
                 window.cameraYaw = activeKey.yaw;
                 window.cameraRoll = activeKey.roll;
                 
                 // Update UI sliders
                 const pitchSlider = document.getElementById('camera-pitch');
                 const yawSlider = document.getElementById('camera-yaw');
                 const rollSlider = document.getElementById('camera-roll');
                 const pitchLabel = document.getElementById('pitch-value');
                 const yawLabel = document.getElementById('yaw-value');
                 const rollLabel = document.getElementById('roll-value');
                 
                 if (pitchSlider) pitchSlider.value = activeKey.pitch;
                 if (yawSlider) yawSlider.value = activeKey.yaw;
                 if (rollSlider) rollSlider.value = activeKey.roll;
                 if (pitchLabel) pitchLabel.textContent = Math.round(activeKey.pitch);
                 if (yawLabel) yawLabel.textContent = Math.round(activeKey.yaw);
                 if (rollLabel) rollLabel.textContent = Math.round(activeKey.roll);
             }
        }
    },
    
    // EXPORT CONFIGS ONLY
    exportConfigs: function() {
        const car = cars[activeCarIndex];
        if (!car) {
            alert("No car selected to save configs from!");
            return;
        }
        
        const getEuler = (quat) => {
             const e = new THREE.Euler().setFromQuaternion(quat, 'YXZ'); 
             return { pitch: e.x, yaw: e.y, roll: e.z };
        };
        
        const cleanDefinitions = (car.userData.cameras || []).map(cam => ({
            name: cam.name,
            offset: { x: cam.offset.x, y: cam.offset.y, z: cam.offset.z },
            rotation: getEuler(cam.rotation)
        }));

        const data = {
            type: "CameraConfigs",
            cameraDefinitions: cleanDefinitions
        };
        
        this.download(data, `cameras_${new Date().getTime()}.json`);
    },
    
    // EXPORT REPLAY ONLY
    exportReplay: function() {
        if (this.keyframes.length === 0) {
            alert("No recording data to save!");
            return;
        }
        
        const data = {
            type: "RaceReplay",
            keyframes: this.keyframes
        };
        
        this.download(data, `replay_${new Date().getTime()}.json`);
    },
    
    download: function(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },
    
    loadJSON: function(json) {
        let data;
        try {
            data = typeof json === 'string' ? JSON.parse(json) : json;
        } catch (e) {
            alert("Failed to parse JSON");
            return;
        }

        const car = cars[activeCarIndex];
        if (!car) {
             alert("Please select a car first to load configs into!");
             return;
        }
        
        // 1. Load Definitions
        if (data.type === "CameraConfigs" || data.cameraDefinitions) {
            if (!car.userData.cameras) car.userData.cameras = [];
            
            data.cameraDefinitions.forEach(def => {
                const existingIdx = car.userData.cameras.findIndex(c => c.name === def.name);
                
                const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                    def.rotation.pitch, 
                    def.rotation.yaw, 
                    def.rotation.roll, 
                    'YXZ'
                ));
                
                const newCam = {
                    name: def.name,
                    offset: new THREE.Vector3(def.offset.x, def.offset.y, def.offset.z),
                    rotation: quat
                };
                
                if (existingIdx !== -1) {
                    car.userData.cameras[existingIdx] = newCam;
                } else {
                    car.userData.cameras.push(newCam);
                }
            });
            
            alert(`Loaded ${data.cameraDefinitions.length} camera configs!`);
            if (window.updateCameraManagerUI) window.updateCameraManagerUI();
        }
        
        // 2. Load Keyframes (if Replay)
        if (data.type === "RaceReplay" || data.keyframes) {
            if (data.keyframes) {
                this.keyframes = data.keyframes;
                this.isPlaying = true;
                this.isRecording = false;
                console.log("Replay Loaded. Keyframes:", this.keyframes.length);
                alert("Replay Loaded! Start the race to see it in action.");
            }
        }
    }
};

// --- Hook Logic ---

function bindRecorderButtons() {
    const btnRecord = document.getElementById('btn-record-camera');
    const btnLoadReplay = document.getElementById('btn-load-replay');
    const fileInputReplay = document.getElementById('file-input-replay');
    
    if (btnRecord) {
        btnRecord.addEventListener('click', () => {
             if (CameraRecorder.isRecording) {
                 CameraRecorder.stopRecording();
             } else {
                 CameraRecorder.startRecording();
             }
        });
    }
    
    if (btnLoadReplay) {
        btnLoadReplay.addEventListener('click', () => fileInputReplay.click());
    }
    
    if (fileInputReplay) {
         fileInputReplay.addEventListener('click', (e) => e.target.value = ''); 
         fileInputReplay.addEventListener('change', (e) => {
             const file = e.target.files[0];
             if (!file) return;
             const reader = new FileReader();
             reader.onload = (ev) => {
                 CameraRecorder.loadJSON(ev.target.result);
             };
             reader.readAsText(file);
        });
    }
    
    // Config Persistence Buttons
    const btnSaveConfigs = document.getElementById('btn-save-configs');
    const btnLoadConfigs = document.getElementById('btn-load-configs');
    const fileInputConfigs = document.getElementById('file-input-configs');
    
    if (btnSaveConfigs) {
        btnSaveConfigs.addEventListener('click', () => {
             CameraRecorder.exportConfigs(); // CHANGED: specific export
        });
    }
    
    if (btnLoadConfigs) {
        btnLoadConfigs.addEventListener('click', () => fileInputConfigs.click());
    }
    
    if (fileInputConfigs) {
        fileInputConfigs.addEventListener('click', (e) => e.target.value = '');
        fileInputConfigs.addEventListener('change', (e) => {
             const file = e.target.files[0];
             if (!file) return;
             const reader = new FileReader();
             reader.onload = (ev) => {
                 CameraRecorder.loadJSON(ev.target.result);
             };
             reader.readAsText(file);
        });
    }
}

bindRecorderButtons();

let _activeCamVal = null;
Object.defineProperty(window, 'activeCameraName', {
    get: function() { return _activeCamVal; },
    set: function(val) {
        _activeCamVal = val;
        if (CameraRecorder) CameraRecorder.logSwitch(val || "Default Chase");
    }
});

// Start the application after all definitions are loaded
init();
animate();
