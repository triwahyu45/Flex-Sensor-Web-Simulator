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
  let match = null;
  root.traverse((object) => {
    if (!match && object.name.toLowerCase().includes(part)) match = object;
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
  const cameraDirection = new THREE.Vector3(1.22, 0.82, 1.35).normalize();
  camera.position.copy(modelCenter).add(cameraDirection.multiplyScalar(cameraDistance));
  controls.target.copy(modelCenter);
  controls.minDistance = cameraDistance * 0.56;
  controls.maxDistance = cameraDistance * 1.75;
  controls.update();

  const jaw = findByNamePart(model, 'dito_pinza');
  const jawFrame = findByNamePart(model, 'blocco_pinza');
  const jawStart = jaw?.position.clone();
  const jawFrameStart = jawFrame?.position.clone();
  const jawTravel = longestSide * 0.026;

  window.scaraViewer = {
    setPose(pan, grip) {
      requestedPose.pan = clamp(Number(pan) || 0, -100, 100);
      requestedPose.grip = clamp(Number(grip) || 0, 0, 100);
    },
    getPose() {
      return { ...requestedPose };
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
    const opening = requestedPose.grip / 100;
    model.rotation.y = THREE.MathUtils.degToRad(requestedPose.pan * 0.75);
    if (jaw && jawStart) jaw.position.x = jawStart.x + jawTravel * opening;
    if (jawFrame && jawFrameStart) jawFrame.position.x = jawFrameStart.x - jawTravel * opening * 0.55;
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
