const CHANNEL_NAME = 'flex-trainer-realtime';
const STORAGE_KEY = 'flex-trainer-payload';
const DEVICE_KEY = 'flex-trainer-mdns';
const SETTINGS_KEY = 'flex-trainer-settings';

const defaults = {
  flexA: 2048,
  flexB: 0,
  pan: 0,
  servo: 90,
  grip: 0,
  phrase: 'Halo',
  mdns: '',
  sentAt: Date.now(),
};

const defaultSettings = {
  servo: { source: 'flexA', inMin: 0, inMax: 4095, outMin: 0, outMax: 180, points: [] },
  gripper: {
    armSource: 'flexA',
    armInMin: 0,
    armInMax: 4095,
    armPoints: [],
    gripSource: 'flexB',
    gripInMin: 0,
    gripInMax: 4095,
    gripPoints: [],
  },
  audio: {
    graphMin: 0,
    graphMax: 4095,
    flexARules: [
      { min: 0, max: 1364, text: 'Halo' },
      { min: 1365, max: 2729, text: 'Apa kabar' },
      { min: 2730, max: 4095, text: 'Semangat' },
    ],
    flexBRules: [
      { min: 0, max: 1364, text: 'Aulia' },
      { min: 1365, max: 2729, text: 'Siap' },
      { min: 2730, max: 4095, text: 'Mantap' },
    ],
  },
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const numeric = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

function mapCalibrated(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;
  const ratio = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + ratio * (outMax - outMin);
}

function mapCalibrationPoints(value, points, fallback) {
  const normalized = points
    .map((point) => ({ adc: numeric(point.adc, NaN), output: numeric(point.output, NaN) }))
    .filter((point) => Number.isFinite(point.adc) && Number.isFinite(point.output))
    .sort((a, b) => a.adc - b.adc);
  const unique = normalized.filter((point, index) => index === 0 || point.adc !== normalized[index - 1].adc);
  if (unique.length < 2 || unique.length !== normalized.length) return fallback();
  if (value <= unique[0].adc) return unique[0].output;
  if (value >= unique.at(-1).adc) return unique.at(-1).output;
  const upperIndex = unique.findIndex((point) => point.adc >= value);
  const lower = unique[upperIndex - 1];
  const upper = unique[upperIndex];
  return mapCalibrated(value, lower.adc, upper.adc, lower.output, upper.output);
}

function normalizeMdns(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!raw) return '';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return raw;
  return raw.endsWith('.local') ? raw : `${raw}.local`;
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    const legacyRules = saved.audio?.rules;
    const audio = {
      ...defaultSettings.audio,
      ...saved.audio,
      flexARules: saved.audio?.flexARules || legacyRules || defaultSettings.audio.flexARules,
      flexBRules: saved.audio?.flexBRules || defaultSettings.audio.flexBRules,
    };
    delete audio.source;
    delete audio.rules;
    return {
      servo: { ...defaultSettings.servo, ...saved.servo, points: saved.servo?.points || [] },
      gripper: {
        ...defaultSettings.gripper,
        ...saved.gripper,
        armPoints: saved.gripper?.armPoints || [],
        gripPoints: saved.gripper?.gripPoints || [],
      },
      audio,
    };
  } catch {
    return structuredClone(defaultSettings);
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function phraseFromRules(value, rules) {
  const rule = rules.find((item) => value >= numeric(item.min) && value <= numeric(item.max));
  return rule?.text || '';
}

function phraseFromFlexes(flexA, flexB, settings) {
  return [
    phraseFromRules(flexA, settings.audio.flexARules),
    phraseFromRules(flexB, settings.audio.flexBRules),
  ].filter(Boolean).join(' ');
}

function payloadFromFlex(flexA, flexB, mdns = '', settings = loadSettings()) {
  const flex = { flexA: numeric(flexA), flexB: numeric(flexB) };
  const servoInput = flex[settings.servo.source] ?? flex.flexA;
  const armInput = flex[settings.gripper.armSource] ?? flex.flexA;
  const gripInput = flex[settings.gripper.gripSource] ?? flex.flexB;

  return {
    flexA: Math.round(flex.flexA),
    flexB: Math.round(flex.flexB),
    pan: round(mapCalibrated(
      mapCalibrationPoints(armInput, settings.gripper.armPoints, () => mapCalibrated(armInput, settings.gripper.armInMin, settings.gripper.armInMax, 0, 100)),
      0, 100, -100, 100,
    ), 1),
    servo: round(mapCalibrationPoints(servoInput, settings.servo.points, () => mapCalibrated(servoInput, settings.servo.inMin, settings.servo.inMax, settings.servo.outMin, settings.servo.outMax)), 1),
    grip: round(mapCalibrationPoints(gripInput, settings.gripper.gripPoints, () => mapCalibrated(gripInput, settings.gripper.gripInMin, settings.gripper.gripInMax, 0, 100)), 1),
    phrase: phraseFromFlexes(flex.flexA, flex.flexB, settings),
    mdns: normalizeMdns(mdns),
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
    led: $('connectionLed'),
    chart: $('flexChart'),
    voiceStatus: $('voiceStatus'),
    enableVoice: $('enableVoice'),
    speakNow: $('speakNow'),
    servoToggle: $('servoToggle'),
    gripperToggle: $('gripperToggle'),
    graphAudioToggle: $('graphAudioToggle'),
    mdnsInput: $('mdnsInput'),
    connectEsp: $('connectEsp'),
    connectSerial: $('connectSerial'),
    disconnectEsp: $('disconnectEsp'),
    mdnsStatus: $('mdnsStatus'),
    mdnsLed: $('mdnsLed'),
  };

  const settings = loadSettings();
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
  let selectedMdns = normalizeMdns(localStorage.getItem(DEVICE_KEY));
  let espPolling = false;
  let pollTimer = null;
  let pollFailures = 0;
  let serialPort = null;
  let serialReader = null;
  let serialActive = false;
  const graph = Array.from({ length: 160 }, () => ({ flexA: current.flexA, flexB: current.flexB }));
  const ctx = refs.chart.getContext('2d');

  refs.mdnsInput.value = selectedMdns.replace('.local', '');

  function setLed(element, state) {
    element.className = `led led-${state}`;
  }

  function bindSetting(id, path, isNumber = false) {
    const element = $(id);
    const [section, key] = path;
    element.value = settings[section][key];
    element.addEventListener('input', () => {
      settings[section][key] = isNumber ? numeric(element.value) : element.value;
      saveSettings(settings);
      target = payloadFromFlex(current.flexA, current.flexB, target.mdns, settings);
      renderAudioRules();
    });
  }

  [
    ['servoSource', ['servo', 'source']],
    ['servoInMin', ['servo', 'inMin'], true],
    ['servoInMax', ['servo', 'inMax'], true],
    ['servoOutMin', ['servo', 'outMin'], true],
    ['servoOutMax', ['servo', 'outMax'], true],
    ['armSource', ['gripper', 'armSource']],
    ['armInMin', ['gripper', 'armInMin'], true],
    ['armInMax', ['gripper', 'armInMax'], true],
    ['gripSource', ['gripper', 'gripSource']],
    ['gripInMin', ['gripper', 'gripInMin'], true],
    ['gripInMax', ['gripper', 'gripInMax'], true],
    ['graphMin', ['audio', 'graphMin'], true],
    ['graphMax', ['audio', 'graphMax'], true],
  ].forEach(([id, path, isNumber]) => bindSetting(id, path, isNumber));

  function renderCalibrationPoints(containerId, points, sourceKey, outputLabel) {
    const container = $(containerId);
    container.innerHTML = '';
    points.forEach((point, index) => {
      const row = document.createElement('div');
      row.className = 'calibration-row';
      row.innerHTML = `
        <input type="number" value="${point.adc}" aria-label="ADC ${outputLabel}" placeholder="ADC" />
        <input type="number" value="${point.output}" aria-label="${outputLabel}" placeholder="${outputLabel}" />
        <button class="mini-action" type="button">Capture</button>
        <button class="mini-action muted" type="button">Hapus</button>
      `;
      const [adcInput, outputInput, captureButton, deleteButton] = row.children;
      const update = () => {
        point.adc = numeric(adcInput.value);
        point.output = numeric(outputInput.value);
        saveSettings(settings);
        target = payloadFromFlex(current.flexA, current.flexB, target.mdns, settings);
      };
      adcInput.addEventListener('input', update);
      outputInput.addEventListener('input', update);
      captureButton.addEventListener('click', () => {
        adcInput.value = Math.round(current[settings[sourceKey.section][sourceKey.key]] ?? current.flexA);
        update();
      });
      deleteButton.addEventListener('click', () => {
        points.splice(index, 1);
        saveSettings(settings);
        renderCalibrationEditors();
      });
      container.appendChild(row);
    });
  }

  function renderCalibrationEditors() {
    renderCalibrationPoints('servoPoints', settings.servo.points, { section: 'servo', key: 'source' }, 'Derajat');
    renderCalibrationPoints('armPoints', settings.gripper.armPoints, { section: 'gripper', key: 'armSource' }, 'Posisi %');
    renderCalibrationPoints('gripPoints', settings.gripper.gripPoints, { section: 'gripper', key: 'gripSource' }, 'Bukaan %');
    target = payloadFromFlex(current.flexA, current.flexB, target.mdns, settings);
  }

  function bindCalibrationAdd(buttonId, points, output = 0) {
    $(buttonId).addEventListener('click', () => {
      points.push({ adc: 0, output });
      saveSettings(settings);
      renderCalibrationEditors();
    });
  }

  bindCalibrationAdd('addServoPoint', settings.servo.points);
  bindCalibrationAdd('addArmPoint', settings.gripper.armPoints);
  bindCalibrationAdd('addGripPoint', settings.gripper.gripPoints);
  renderCalibrationEditors();

  function setHeaderStatus(text, state = 'yellow') {
    refs.status.innerHTML = `<i id="connectionLed" class="led led-${state}"></i> ${text}`;
    refs.status.classList.toggle('live', state === 'green');
    refs.led = document.getElementById('connectionLed');
  }

  function acceptPayload(payload, source = 'Virtual') {
    const incomingMdns = normalizeMdns(payload?.mdns);
    if (selectedMdns && incomingMdns && incomingMdns !== selectedMdns) {
      setHeaderStatus('Disconnected - mDNS mismatch', 'red');
      setConnectionStatus(`mDNS mismatch: ${incomingMdns}`, 'red');
      return;
    }
    const rawFlexA = numeric(payload.flexA, defaults.flexA);
    const rawFlexB = numeric(payload.flexB, defaults.flexB);
    target = payloadFromFlex(rawFlexA, rawFlexB, incomingMdns, settings);
    setHeaderStatus(source, 'green');
  }

  createChannel((payload) => {
    if (!espPolling && !serialActive) acceptPayload(payload, 'Virtual data');
  });

  function setConnectionStatus(text, state = 'red') {
    refs.mdnsStatus.innerHTML = `<i id="mdnsLed" class="led led-${state}"></i> ${text}`;
    refs.mdnsLed = document.getElementById('mdnsLed');
  }

  async function disconnectSerial() {
    serialActive = false;
    if (serialReader) {
      try {
        await serialReader.cancel();
      } catch {}
    }
    if (serialPort) {
      try {
        while (serialReader) {
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        await serialPort.close();
      } catch {}
      serialPort = null;
    }
  }

  function acceptSerialLine(line) {
    const match = line.match(/FlexA:\s*(\d+)\s+FlexB:\s*(\d+)/i)
      || line.match(/Flex A:\s*(\d+)\s*\|\s*Flex B:\s*(\d+)/i);
    if (!match) return;
    acceptPayload({ flexA: Number(match[1]), flexB: Number(match[2]) }, 'Serial ESP32');
    setConnectionStatus('Connected: Serial ESP32', 'green');
  }

  async function readSerialLoop() {
    const decoder = new TextDecoder();
    let buffer = '';
    while (serialActive && serialPort?.readable) {
      serialReader = serialPort.readable.getReader();
      try {
        while (serialActive) {
          const { value, done } = await serialReader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          lines.forEach(acceptSerialLine);
        }
      } catch {
        if (serialActive) {
          setHeaderStatus('Reconnecting - Serial unavailable', 'yellow');
          setConnectionStatus('Reconnect Serial ESP32', 'yellow');
        }
      } finally {
        serialReader.releaseLock();
        serialReader = null;
      }
    }
  }

  async function pollEsp32() {
    if (!espPolling || !selectedMdns) return;
    try {
      const response = await fetch(`http://${selectedMdns}/data`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (typeof data.flexA !== 'number' || typeof data.flexB !== 'number') throw new Error('Invalid payload');
      pollFailures = 0;
      acceptPayload({ flexA: data.flexA, flexB: data.flexB, mdns: selectedMdns }, `ESP32 ${selectedMdns}`);
      setConnectionStatus(`Connected: ${selectedMdns}`, 'green');
    } catch {
      pollFailures++;
      if (pollFailures >= 5) {
        setHeaderStatus('Reconnecting - ESP32 unavailable', 'yellow');
        setConnectionStatus(`Reconnecting: ${selectedMdns}`, 'yellow');
      }
    } finally {
      if (espPolling) pollTimer = window.setTimeout(pollEsp32, pollFailures ? 80 : 20);
    }
  }

  refs.connectEsp.addEventListener('click', async () => {
    await disconnectSerial();
    selectedMdns = normalizeMdns(refs.mdnsInput.value);
    refs.mdnsInput.value = selectedMdns.replace('.local', '');
    localStorage.setItem(DEVICE_KEY, selectedMdns);
    if (!selectedMdns) {
      espPolling = false;
      window.clearTimeout(pollTimer);
      setConnectionStatus('Virtual/manual mode', 'yellow');
      return;
    }
    espPolling = true;
    pollFailures = 0;
    window.clearTimeout(pollTimer);
    setConnectionStatus(`Connecting: ${selectedMdns}`, 'yellow');
    pollEsp32();
  });

  refs.connectSerial.addEventListener('click', async () => {
    if (!('serial' in navigator)) {
      setHeaderStatus('Web Serial unsupported', 'red');
      setConnectionStatus('Gunakan Chrome atau Edge via HTTPS/localhost', 'red');
      return;
    }
    try {
      espPolling = false;
      window.clearTimeout(pollTimer);
      await disconnectSerial();
      setHeaderStatus('Connecting Serial ESP32', 'yellow');
      setConnectionStatus('Pilih COM ESP32...', 'yellow');
      serialPort = await navigator.serial.requestPort();
      await serialPort.open({ baudRate: 115200 });
      serialActive = true;
      setHeaderStatus('Serial ESP32', 'green');
      setConnectionStatus('Connected: Serial ESP32', 'green');
      readSerialLoop();
    } catch {
      await disconnectSerial();
      setHeaderStatus('Disconnected - Serial unavailable', 'red');
      setConnectionStatus('Serial cancelled or unavailable', 'red');
    }
  });

  refs.disconnectEsp.addEventListener('click', async () => {
    espPolling = false;
    pollFailures = 0;
    window.clearTimeout(pollTimer);
    await disconnectSerial();
    setHeaderStatus('Disconnected', 'red');
    setConnectionStatus('Disconnected', 'red');
  });

  if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', async (event) => {
      if (event.target !== serialPort) return;
      await disconnectSerial();
      setHeaderStatus('Disconnected - Serial removed', 'red');
      setConnectionStatus('Serial ESP32 disconnected', 'red');
    });
  }

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

  function renderRuleSet(containerId, rules, sensorLabel) {
    const container = $(containerId);
    container.innerHTML = '';
    rules.forEach((rule, index) => {
      const row = document.createElement('div');
      row.className = 'rule-row';
      row.innerHTML = `
        <input type="number" value="${rule.min}" aria-label="${sensorLabel} min suara" />
        <input type="number" value="${rule.max}" aria-label="${sensorLabel} max suara" />
        <input type="text" value="${rule.text}" aria-label="${sensorLabel} text suara" />
        <button class="mini-action" type="button">Hapus</button>
      `;
      const [minInput, maxInput, textInput, deleteButton] = row.children;
      minInput.addEventListener('input', () => {
        rule.min = numeric(minInput.value);
        saveSettings(settings);
        target = payloadFromFlex(current.flexA, current.flexB, target.mdns, settings);
      });
      maxInput.addEventListener('input', () => {
        rule.max = numeric(maxInput.value);
        saveSettings(settings);
        target = payloadFromFlex(current.flexA, current.flexB, target.mdns, settings);
      });
      textInput.addEventListener('input', () => {
        rule.text = textInput.value;
        saveSettings(settings);
        target = payloadFromFlex(current.flexA, current.flexB, target.mdns, settings);
      });
      deleteButton.addEventListener('click', () => {
        rules.splice(index, 1);
        saveSettings(settings);
        renderAudioRules();
      });
      container.appendChild(row);
    });
  }

  function renderAudioRules() {
    renderRuleSet('audioRulesA', settings.audio.flexARules, 'Flex A');
    renderRuleSet('audioRulesB', settings.audio.flexBRules, 'Flex B');
    target = payloadFromFlex(current.flexA, current.flexB, target.mdns, settings);
  }

  $('addAudioRuleA').addEventListener('click', () => {
    settings.audio.flexARules.push({ min: 0, max: 4095, text: 'Flex A baru' });
    saveSettings(settings);
    renderAudioRules();
  });

  $('addAudioRuleB').addEventListener('click', () => {
    settings.audio.flexBRules.push({ min: 0, max: 4095, text: 'Flex B baru' });
    saveSettings(settings);
    renderAudioRules();
  });
  renderAudioRules();

  function speak(text, force = false) {
    if (!text || !voiceEnabled || !modules.graphAudio || !('speechSynthesis' in window)) return;
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
    ctx.fillStyle = '#08090a';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const graphMin = numeric(settings.audio.graphMin);
    const graphMax = numeric(settings.audio.graphMax, 4095);
    const drawLine = (key, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      graph.forEach((point, index) => {
        const x = (index / (graph.length - 1)) * width;
        const normalized = clamp((point[key] - graphMin) / (graphMax - graphMin || 1), 0, 1);
        const y = height - normalized * height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    drawLine('flexA', '#38d5e8');
    drawLine('flexB', '#79e39f');
    ctx.fillStyle = '#8e959d';
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
    refs.servoFlex.textContent = current[settings.servo.source] ?? current.flexA;

    if (modules.servo) {
      current.servo = target.servo;
      refs.needle.style.transform = `rotate(${-90 + current.servo}deg)`;
      refs.servo.textContent = Math.round(current.servo);
    }

    if (modules.gripper) {
      current.pan = target.pan;
      current.grip = target.grip;
      const panPx = current.pan * 2.05;
      const jawAngle = mapCalibrated(current.grip, 0, 100, 0, 25);
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

  setConnectionStatus('Disconnected', 'red');
  refs.leftJaw.style.transformOrigin = '324px 306px';
  refs.rightJaw.style.transformOrigin = '436px 306px';
  drawChart();
  requestAnimationFrame(draw);
}

const sketch = `#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>

const char* ssid = "NAMA_WIFI";
const char* password = "PASSWORD_WIFI";
const char* mdnsName = "flex-kelompok1";

const int FLEX_A_PIN = 34;
const int FLEX_B_PIN = 35;
const int SAMPLE_COUNT = 5;
const unsigned long SENSOR_INTERVAL_MS = 5;
const unsigned long SERIAL_INTERVAL_MS = 50;
const unsigned long WIFI_RETRY_INTERVAL_MS = 5000;

WebServer server(80);
int readingsA[SAMPLE_COUNT];
int readingsB[SAMPLE_COUNT];
int readIndex = 0;
long totalA = 0;
long totalB = 0;
int flexA = 0;
int flexB = 0;
unsigned long lastSensorRead = 0;
unsigned long lastSerialPrint = 0;
unsigned long lastWifiRetry = 0;
bool serverStarted = false;
bool mdnsStarted = false;

const char MONITOR_PAGE[] PROGMEM = R"rawliteral(
<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>ESP32 Flex Monitor</title>
    <style>
      body{margin:0;padding:24px;font-family:Arial,sans-serif;color:#f4f7fb;background:#08090a}
      main{max-width:520px;margin:auto}h1{font-size:22px}section{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      article{padding:18px;border:1px solid #2a2d31;border-radius:8px;background:#15171a}
      span{display:block;color:#8e959d;font-size:12px}strong{display:block;margin-top:8px;color:#79e39f;font-size:36px}
    </style>
  </head>
  <body>
    <main>
      <h1>ESP32 Flex Monitor</h1>
      <section>
        <article><span>Flex A</span><strong id="a">-</strong></article>
        <article><span>Flex B</span><strong id="b">-</strong></article>
      </section>
    </main>
    <script>
      async function update(){
        try{
          const response=await fetch('/data',{cache:'no-store'});
          const data=await response.json();
          document.getElementById('a').textContent=data.flexA;
          document.getElementById('b').textContent=data.flexB;
        }catch(error){}
      }
      async function refresh(){
        await update();
        setTimeout(refresh,25);
      }
      refresh();
    </script>
  </body>
</html>
)rawliteral";

void sendCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void initializeFlexReadings() {
  int initialA = analogRead(FLEX_A_PIN);
  int initialB = analogRead(FLEX_B_PIN);
  for (int i = 0; i < SAMPLE_COUNT; i++) {
    readingsA[i] = initialA;
    readingsB[i] = initialB;
    totalA += initialA;
    totalB += initialB;
  }
  flexA = initialA;
  flexB = initialB;
}

void updateFlexReadings() {
  totalA -= readingsA[readIndex];
  totalB -= readingsB[readIndex];

  readingsA[readIndex] = analogRead(FLEX_A_PIN);
  readingsB[readIndex] = analogRead(FLEX_B_PIN);

  totalA += readingsA[readIndex];
  totalB += readingsB[readIndex];

  readIndex++;
  if (readIndex >= SAMPLE_COUNT) {
    readIndex = 0;
  }

  flexA = totalA / SAMPLE_COUNT;
  flexB = totalB / SAMPLE_COUNT;

}

void handleData() {
  String json = "{\\\"flexA\\\":" + String(flexA) + ",\\\"flexB\\\":" + String(flexB) + "}";
  sendCors();
  server.send(200, "application/json", json);
}

void startMdns() {
  if (MDNS.begin(mdnsName)) {
    mdnsStarted = true;
    Serial.println("Monitor: http://" + String(mdnsName) + ".local");
    Serial.println("JSON API: http://" + String(mdnsName) + ".local/data");
  }
}

void startWebServer() {
  startMdns();
  server.on("/", HTTP_GET, []() {
    server.send_P(200, "text/html", MONITOR_PAGE);
  });
  server.on("/data", HTTP_OPTIONS, []() {
    sendCors();
    server.send(204);
  });
  server.on("/data", HTTP_GET, handleData);
  server.begin();
  serverStarted = true;
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetPinAttenuation(FLEX_A_PIN, ADC_11db);
  analogSetPinAttenuation(FLEX_B_PIN, ADC_11db);

  initializeFlexReadings();
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  Serial.println("Menghubungkan ke WiFi: " + String(ssid));
  WiFi.begin(ssid, password);
}

void loop() {
  unsigned long now = millis();

  if (now - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = now;
    updateFlexReadings();
  }

  if (now - lastSerialPrint >= SERIAL_INTERVAL_MS) {
    lastSerialPrint = now;
    Serial.print("FlexA:");
    Serial.print(flexA);
    Serial.print(" FlexB:");
    Serial.println(flexB);
  }

  if (WiFi.status() == WL_CONNECTED) {
    if (!serverStarted) {
      Serial.println("WiFi tersambung");
      Serial.println("Monitor IP: http://" + WiFi.localIP().toString());
      startWebServer();
    } else if (!mdnsStarted) {
      Serial.println("WiFi tersambung kembali");
      Serial.println("Monitor IP: http://" + WiFi.localIP().toString());
      startMdns();
    }
    server.handleClient();
  } else {
    if (mdnsStarted) {
      MDNS.end();
      mdnsStarted = false;
    }
    if (now - lastWifiRetry >= WIFI_RETRY_INTERVAL_MS) {
      lastWifiRetry = now;
      Serial.println("WiFi belum tersambung, status: " + String(WiFi.status()));
      WiFi.reconnect();
    }
  }
}`;

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
  const virtualMdnsInput = $('virtualMdnsInput');
  const espSketch = $('espSketch');
  const copySketch = $('copySketch');
  const channel = createChannel(() => {});
  const settings = loadSettings();

  espSketch.textContent = sketch;
  copySketch.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(sketch);
    copySketch.textContent = 'Copied';
    window.setTimeout(() => (copySketch.textContent = 'Copy'), 900);
  });

  virtualMdnsInput.value = normalizeMdns(localStorage.getItem(DEVICE_KEY)).replace('.local', '');

  let payload = payloadFromFlex(Number(flexAInput.value), Number(flexBInput.value), virtualMdnsInput.value, settings);
  let lastSend = 0;

  function updatePayload() {
    const mdns = normalizeMdns(virtualMdnsInput.value);
    localStorage.setItem(DEVICE_KEY, mdns);
    payload = payloadFromFlex(Number(flexAInput.value), Number(flexBInput.value), mdns, settings);
    flexARead.textContent = payload.flexA;
    flexBRead.textContent = payload.flexB;
    fpsRead.textContent = `${fpsInput.value} FPS`;
    payloadPreview.textContent = JSON.stringify(payload, null, 2);
  }

  function sendNow() {
    updatePayload();
    channel.send(payload);
  }

  [flexAInput, flexBInput, fpsInput, virtualMdnsInput].forEach((input) => {
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
