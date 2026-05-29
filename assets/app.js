const CHANNEL_NAME = 'flex-trainer-realtime';
const STORAGE_KEY = 'flex-trainer-payload';

const defaults = {
  flexA: 2048,
  flexB: 0,
  pan: 0,
  servo: 90,
  grip: 0,
  phrase: 'Halo',
  sentAt: Date.now(),
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const map = (value, inMin, inMax, outMin, outMax) => {
  const ratio = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + ratio * (outMax - outMin);
};
const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function phraseFromFlex(flexB) {
  if (flexB < 1365) return 'Halo';
  if (flexB < 2730) return 'Apa kabar';
  return 'Semangat';
}

function payloadFromFlex(flexA, flexB) {
  return {
    flexA: Math.round(flexA),
    flexB: Math.round(flexB),
    pan: round(map(flexA, 0, 4095, -100, 100), 1),
    servo: round(map(flexA, 0, 4095, 0, 180), 1),
    grip: round(map(flexB, 0, 4095, 0, 100), 1),
    phrase: phraseFromFlex(flexB),
    sentAt: Date.now(),
  };
}

function readPayload() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return defaults;
  }
}

function createChannel(onPayload) {
  let channel = null;
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      if (event.data?.type === 'payload') onPayload(event.data.payload);
    };
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      onPayload(JSON.parse(event.newValue));
    } catch {
      onPayload(defaults);
    }
  });

  return {
    send(payload) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      channel?.postMessage({ type: 'payload', payload });
    },
  };
}

function initSimulator() {
  const $ = (id) => document.getElementById(id);
  const refs = {
    arm: $('armGroup'),
    leftJaw: $('leftJaw'),
    rightJaw: $('rightJaw'),
    needle: $('needle'),
    flexA: $('flexARead'),
    flexB: $('flexBRead'),
    headerFlex: $('headerFlexRead'),
    pan: $('panRead'),
    grip: $('gripRead'),
    servo: $('servoRead'),
    servoFlex: $('servoFlexRead'),
    activeModules: $('activeModulesRead'),
    status: $('connectionStatus'),
    chart: $('flexChart'),
    voiceStatus: $('voiceStatus'),
    enableVoice: $('enableVoice'),
    speakNow: $('speakNow'),
    servoToggle: $('servoToggle'),
    gripperToggle: $('gripperToggle'),
    graphAudioToggle: $('graphAudioToggle'),
  };

  const modules = {
    servo: refs.servoToggle.checked,
    gripper: refs.gripperToggle.checked,
    graphAudio: refs.graphAudioToggle.checked,
  };

  let voiceEnabled = false;
  let lastPhrase = '';
  let lastVoiceAt = 0;
  let lastGraphAt = 0;
  let target = readPayload();
  let current = { ...target };
  const graph = Array.from({ length: 160 }, () => ({ flexA: current.flexA, flexB: current.flexB }));
  const ctx = refs.chart.getContext('2d');

  createChannel((payload) => {
    target = { ...defaults, ...payload };
    refs.status.textContent = 'Live data';
    refs.status.classList.add('live');
  });

  function syncModuleState() {
    modules.servo = refs.servoToggle.checked;
    modules.gripper = refs.gripperToggle.checked;
    modules.graphAudio = refs.graphAudioToggle.checked;
    document.querySelector('[data-module-card="servo"]').classList.toggle('module-off', !modules.servo);
    document.querySelector('[data-module-card="gripper"]').classList.toggle('module-off', !modules.gripper);
    document.querySelector('[data-module-card="graphAudio"]').classList.toggle('module-off', !modules.graphAudio);
    refs.activeModules.textContent = Object.values(modules).filter(Boolean).length;
  }

  [refs.servoToggle, refs.gripperToggle, refs.graphAudioToggle].forEach((toggle) => {
    toggle.addEventListener('change', syncModuleState);
  });
  syncModuleState();

  function speak(text, force = false) {
    if (!voiceEnabled || !modules.graphAudio || !('speechSynthesis' in window)) return;
    const now = performance.now();
    if (!force && (text === lastPhrase || now - lastVoiceAt < 1500)) return;
    lastPhrase = text;
    lastVoiceAt = now;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'id-ID';
    utterance.rate = 1;
    speechSynthesis.speak(utterance);
    refs.voiceStatus.textContent = text;
  }

  refs.enableVoice.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    refs.enableVoice.textContent = voiceEnabled ? 'Disable Voice' : 'Enable Voice';
    refs.voiceStatus.textContent = voiceEnabled ? 'Audio ready' : 'Audio off';
  });

  refs.speakNow.addEventListener('click', () => {
    voiceEnabled = true;
    refs.enableVoice.textContent = 'Disable Voice';
    speak(target.phrase, true);
  });

  function drawChart() {
    const width = refs.chart.width;
    const height = refs.chart.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#08111f';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(125, 162, 255, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const drawLine = (key, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      graph.forEach((point, index) => {
        const x = (index / (graph.length - 1)) * width;
        const y = height - (point[key] / 4095) * height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    drawLine('flexA', '#62e5ff');
    drawLine('flexB', '#75f0b1');

    ctx.fillStyle = '#90aec0';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText('Flex A', 12, 20);
    ctx.fillText('Flex B', 72, 20);
  }

  function draw(time) {
    current.flexA = target.flexA;
    current.flexB = target.flexB;
    refs.flexA.textContent = current.flexA;
    refs.flexB.textContent = current.flexB;
    refs.headerFlex.textContent = `Flex A ${current.flexA} - Flex B ${current.flexB}`;
    refs.servoFlex.textContent = current.flexA;

    if (modules.servo) {
      current.servo += (target.servo - current.servo) * 0.8;
      refs.needle.style.transform = `rotate(${-90 + current.servo}deg)`;
      refs.servo.textContent = Math.round(current.servo);
    }

    if (modules.gripper) {
      current.pan += (target.pan - current.pan) * 0.8;
      current.grip += (target.grip - current.grip) * 0.8;
      const panPx = current.pan * 2.05;
      const jawAngle = map(current.grip, 0, 100, 0, 25);
      refs.arm.style.transform = `translate3d(${panPx}px, 0, 0)`;
      refs.leftJaw.style.transform = `rotate(${-jawAngle}deg)`;
      refs.rightJaw.style.transform = `rotate(${jawAngle}deg)`;
      refs.pan.textContent = `${Math.round(current.pan)}%`;
      refs.grip.textContent = `${Math.round(current.grip)}%`;
    }

    if (modules.graphAudio && time - lastGraphAt > 65) {
      graph.push({ flexA: current.flexA, flexB: current.flexB });
      graph.shift();
      drawChart();
      speak(target.phrase);
      lastGraphAt = time;
    }

    requestAnimationFrame(draw);
  }

  refs.leftJaw.style.transformOrigin = '324px 306px';
  refs.rightJaw.style.transformOrigin = '436px 306px';
  drawChart();
  requestAnimationFrame(draw);
}

function initVirtualEsp32() {
  const $ = (id) => document.getElementById(id);
  const flexAInput = $('flexAInput');
  const flexBInput = $('flexBInput');
  const fpsInput = $('fpsInput');
  const centerInputs = $('centerInputs');
  const flexARead = $('virtualFlexARead');
  const flexBRead = $('virtualFlexBRead');
  const fpsRead = $('fpsRead');
  const payloadPreview = $('payloadPreview');
  const channel = createChannel(() => {});

  let payload = payloadFromFlex(Number(flexAInput.value), Number(flexBInput.value));
  let lastSend = 0;

  function updatePayload() {
    payload = payloadFromFlex(Number(flexAInput.value), Number(flexBInput.value));
    flexARead.textContent = payload.flexA;
    flexBRead.textContent = payload.flexB;
    fpsRead.textContent = `${fpsInput.value} FPS`;
    payloadPreview.textContent = JSON.stringify(payload, null, 2);
  }

  function sendNow() {
    updatePayload();
    channel.send(payload);
  }

  [flexAInput, flexBInput, fpsInput].forEach((input) => {
    input.addEventListener('input', sendNow);
  });

  centerInputs.addEventListener('click', () => {
    flexAInput.value = 2048;
    flexBInput.value = 0;
    sendNow();
  });

  function stream(time) {
    const fps = Number(fpsInput.value);
    const frameMs = 1000 / fps;
    if (time - lastSend >= frameMs) {
      lastSend = time;
      sendNow();
    }
    requestAnimationFrame(stream);
  }

  sendNow();
  requestAnimationFrame(stream);
}

if (document.body.dataset.page === 'simulator') initSimulator();
if (document.body.dataset.page === 'virtual') initVirtualEsp32();
