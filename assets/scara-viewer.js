import * as THREE from './vendor/three/three.module.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { OrbitControls } from './vendor/three/OrbitControls.js';

const host = document.getElementById('scaraCanvasHost');
const fallback = document.getElementById('scaraFallback');
const loading = document.getElementById('scaraLoading');
const requestedPose = { pan: 0, grip: 0 };

function showFallback(message = 'SCARA 3D tidak tersedia') {
  if (host) host.hidden = true;
  if (fallback) fallback.hidden = false;
  if (loading) loading.textContent = message;
}

function findByNamePart(root, part) {
  const normalizedPart = part.toLowerCase().replace(/[^a-z0-9]/g, '');
  let match = null;
  root.traverse((object) => {
    const normalizedName = object.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!match && normalizedName.includes(normalizedPart)) match = object;
  });
  return match;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setRendererSize(renderer, camera) {
  const width = Math.max(host.clientWidth, 1);
  const height = Math.max(host.clientHeight, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

async function initialize() {
  if (!host || !fallback || !window.WebGLRenderingContext) {
    showFallback();
    return;
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x090a0b, 1);
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI * 0.16;
  controls.maxPolarAngle = Math.PI * 0.49;

  scene.add(new THREE.HemisphereLight(0xdcefff, 0x111216, 2.25));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
  keyLight.position.set(4, 7, 4);
  scene.add(keyLight);
  const edgeLight = new THREE.DirectionalLight(0x38d5e8, 1.25);
  edgeLight.position.set(-4, 3, -3);
  scene.add(edgeLight);

  const modelUrl = new URLSearchParams(window.location.search).get('scaraModel') || 'assets/models/scara-web.glb';
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const model = gltf.scene;
  scene.add(model);

  const rack = findByNamePart(model, 'cremagliera:1');
  const pinion = findByNamePart(model, 'pignone_17mm:1');
  const carriage = findByNamePart(model, 'assieme_pinza:1');
  const jaw = findByNamePart(model, 'dito_pinza_mg90s:1');
  const rackStart = rack?.position.clone();
  const pinionRotationStart = pinion?.rotation.clone();
  const carriageStart = carriage?.position.clone();
  const jawStart = jaw?.position.clone();
  const rackSize = rack ? new THREE.Box3().setFromObject(rack).getSize(new THREE.Vector3()) : new THREE.Vector3();
  const pinionSize = pinion ? new THREE.Box3().setFromObject(pinion).getSize(new THREE.Vector3()) : new THREE.Vector3();
  const jawSize = jaw ? new THREE.Box3().setFromObject(jaw).getSize(new THREE.Vector3()) : new THREE.Vector3();
  const rackTravel = rackSize.x * 0.2;
  const pinionPitchRadius = Math.max(pinionSize.x, pinionSize.z) * 0.5;
  const jawTravel = jawSize.x * 0.18;

  const initialBox = new THREE.Box3().setFromObject(model);
  const initialSize = initialBox.getSize(new THREE.Vector3());
  const initialCenter = initialBox.getCenter(new THREE.Vector3());
  const longestSide = Math.max(initialSize.x, initialSize.y, initialSize.z);
  const scale = 3.7 / longestSide;
  model.scale.setScalar(scale);
  model.position.set(-initialCenter.x * scale, -initialBox.min.y * scale, -initialCenter.z * scale);

  const modelBox = new THREE.Box3().setFromObject(model);
  const modelSize = modelBox.getSize(new THREE.Vector3());
  const modelCenter = modelBox.getCenter(new THREE.Vector3());
  const frameSize = Math.max(modelSize.x, modelSize.y, modelSize.z);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(frameSize * 0.78, 48),
    new THREE.MeshStandardMaterial({ color: 0x121416, roughness: 0.9, metalness: 0.08 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.014;
  scene.add(ground);

  const sphere = modelBox.getBoundingSphere(new THREE.Sphere());
  const cameraDistance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.18;
  const cameraDirection = new THREE.Vector3(0, 0, 1);
  camera.position.copy(modelCenter).add(cameraDirection.multiplyScalar(cameraDistance));
  controls.target.copy(modelCenter);
  controls.minDistance = cameraDistance * 0.56;
  controls.maxDistance = cameraDistance * 1.75;
  controls.update();

  window.scaraViewer = {
    setPose(pan, grip) {
      requestedPose.pan = clamp(Number(pan) || 0, -100, 100);
      requestedPose.grip = clamp(Number(grip) || 0, 0, 100);
    },
    getPose() {
      return { ...requestedPose };
    },
    getMechanics() {
      return {
        rackX: rack?.position.x,
        pinionY: pinion?.rotation.y,
        carriageX: carriage?.position.x,
        jawX: jaw?.position.x,
      };
    },
  };

  if (loading) loading.hidden = true;
  const resizeObserver = new ResizeObserver(() => setRendererSize(renderer, camera));
  resizeObserver.observe(host);
  setRendererSize(renderer, camera);

  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    resizeObserver.disconnect();
    showFallback('WebGL terputus - memakai fallback');
  });

  function animate() {
    if (host.hidden) return;
    const rackPosition = requestedPose.pan / 100;
    const opening = requestedPose.grip / 100;
    const rackOffset = rackTravel * rackPosition;
    if (rack && rackStart) rack.position.x = rackStart.x + rackOffset;
    if (pinion && pinionRotationStart && pinionPitchRadius) {
      pinion.rotation.y = pinionRotationStart.y - rackOffset / pinionPitchRadius;
    }
    if (carriage && carriageStart) carriage.position.copy(carriageStart);
    if (jaw && jawStart) jaw.position.x = jawStart.x + jawTravel * opening;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();
}

initialize().catch((error) => {
  console.error('SCARA 3D gagal dimuat:', error);
  showFallback();
});
