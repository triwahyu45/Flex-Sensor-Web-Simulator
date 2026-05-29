const CHANNEL_NAME = 'flex-trainer-realtime';
const STORAGE_KEY = 'flex-trainer-payload';

const defaults = {
  flexA: 2048,
  flexB: 0,
  pan: 0,
  servo: 0,
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

function payloadFromFlex(flexA, flexB) {
  const pan = map(flexA, 0, 4095, -100, 100);
  const servo = map(flexB, 0, 4095, 0, 180);
  const grip = map(flexB, 0, 4095, 0, 100);
  const phrase = flexB < 1365 ? 'Halo' : flexB < 2730 ? 'Apa kabar' : 'Semangat';

  return {
    flexA: Math.round(flexA),
    flexB: Math.round(flexB),
    pan: round(pan, 1),
    servo: round(servo, 1),
    grip: round(grip, 1),
    phrase,
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
    pan: $('panRead'),
    grip: $('gripRead'),
    servo: $('servoRead'),
    status: $('connectionStatus'),
    modeTitle: $('activeModeTitle'),
    modeDescription: $('modeDescription'),
    voiceStatus: $('voiceStatus'),
    enableVoice: $('enableVoice'),
    speakNow: $('speakNow'),
  };

  let mode = 'servo';
  let voiceEnabled = false;
  let lastPhrase = '';
  let lastVoiceAt = 0;
  let target = readPayload();
  let current = { ...target };

  const descriptions = {
    servo: 'Flex B mengontrol servo dan bukaan gripper secara realtime.',
    arm: 'Flex A menggeser arm/gripper kiri-kanan. Flex B tetap bisa membuka grip untuk melihat kombinasi gerak.',
    voice: 'Nilai analog memicu suara laptop. Aktifkan voice dulu supaya browser mengizinkan output suara.',
  };

  createChannel((payload) => {
    target = { ...defaults, ...payload };
    refs.status.textContent = 'Live data';
    refs.status.classList.add('live');
  });

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.mode;
      document.querySelectorAll('[data-mode]').forEach((item) => item.classList.toggle('active', item === button));
      refs.modeTitle.textContent = button.textContent;
      refs.modeDescription.textContent = descriptions[mode];
    });
  });

  function speak(text, force = false) {
    if (!voiceEnabled || !('speechSynthesis' in window)) return;
    const now = performance.now();
    if (!force && (text === lastPhrase || now - lastVoiceAt < 1400)) return;
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
    refs.voiceStatus.textContent = voiceEnabled ? 'Voice ready' : 'Voice off';
  });

  refs.speakNow.addEventListener('click', () => {
    voiceEnabled = true;
    refs.enableVoice.textContent = 'Disable Voice';
    speak(target.phrase, true);
  });

  function draw() {
    current.pan += (target.pan - current.pan) * 0.65;
    current.servo += (target.servo - current.servo) * 0.65;
    current.grip += (target.grip - current.grip) * 0.65;
    current.flexA = target.flexA;
    current.flexB = target.flexB;

    const panPx = current.pan * 2.05;
    const jawAngle = map(current.grip, 0, 100, 0, 25);
    const needleAngle = -90 + current.servo;

    refs.arm.style.transform = `translate3d(${panPx}px, 0, 0)`;
    refs.leftJaw.style.transformOrigin = '324px 306px';
    refs.rightJaw.style.transformOrigin = '436px 306px';
    refs.leftJaw.style.transform = `rotate(${-jawAngle}deg)`;
    refs.rightJaw.style.transform = `rotate(${jawAngle}deg)`;
    refs.needle.style.transform = `rotate(${needleAngle}deg)`;

    refs.flexA.textContent = current.flexA;
    refs.flexB.textContent = current.flexB;
    refs.pan.textContent = `${Math.round(current.pan)}%`;
    refs.grip.textContent = `${Math.round(current.grip)}%`;
    refs.servo.textContent = Math.round(current.servo);

    if (mode === 'voice') speak(target.phrase);
    requestAnimationFrame(draw);
  }

  draw();
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
