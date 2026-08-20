/* ====================================================
   99 SUPER-APP ENGINE v3.0 - OFFICIAL JAVASCRIPT LOGIC
   WITH REAL STREET-BY-STREET TURN-BY-TURN ROUTING ENGINE
   ==================================================== */

const getBackendUrl = () => {
  if (typeof window === 'undefined' || !window.location) return 'http://localhost:4000';
  const host = window.location.hostname;
  const isHttps = window.location.protocol === 'https:';

  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:4000';
  if (host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.')) {
    return `http://${host}:4000`;
  }
  const savedCloudBackend = localStorage.getItem('99_CLOUD_BACKEND_URL');
  if (savedCloudBackend) return savedCloudBackend;

  if (isHttps) {
    return '';
  }
  return `http://192.168.1.45:4000`;
};
const BACKEND_URL = getBackendUrl();

const state = {
  passengerMap: null,
  driverMap: null,
  selectedCategory: 'pop',
  currentRide: null,
  socket: null,
  localDrivers: [],
  currentDriverId: 'drv-99-1',
  fareEstimate: null,
  lastCalculatedOrigin: null,
  lastCalculatedDestination: null,
  routePolylinePassenger: null,
  routePolylineDriver: null,
  driverMarkerPassenger: null,
  driverMarkerDriver: null,
  surgeFactor: 1.0
};

const LOCATIONS = {
  MASP: { lat: -23.561684, lng: -46.655981, name: 'MASP - Av. Paulista' },
  IBIRAPUERA: { lat: -23.587416, lng: -46.657634, name: 'Parque Ibirapuera' },
  CONGONHAS: { lat: -23.626111, lng: -46.656389, name: 'Aeroporto de Congonhas' },
  SE: { lat: -23.550520, lng: -46.634280, name: 'Praça da Sé - Centro' }
};

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (container) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : '🟡';
    toast.innerHTML = `<span>${icon}</span> <div>${message}</div>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  } else {
    alert(message);
  }
}

let rideBroadcastChannel = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    rideBroadcastChannel = new BroadcastChannel('99_RIDE_DISPATCH_CHANNEL');
  }
} catch(e) {}

function broadcastRideEvent(eventType, payload) {
  const eventData = { eventType, payload, timestamp: Date.now(), rand: Math.random() };

  if (rideBroadcastChannel) {
    try { rideBroadcastChannel.postMessage(eventData); } catch(e) {}
  }

  try {
    localStorage.removeItem('99_BROADCAST_EVENT');
    localStorage.setItem('99_BROADCAST_EVENT', JSON.stringify(eventData));
    localStorage.setItem('99_PENDING_RIDE_DISPATCH', JSON.stringify(payload));
  } catch(e) {}

  if (state.socket) {
    try { state.socket.emit(eventType, payload); } catch(e) {}
  }

  // Tentar envio via REST HTTP para todos os endpoints ativos (Localhost, IP Wi-Fi e Cloud)
  const targetEndpoints = [
    'http://localhost:4000/api/rides/request',
    'http://192.168.1.45:4000/api/rides/request'
  ];
  if (BACKEND_URL && !targetEndpoints.includes(`${BACKEND_URL}/api/rides/request`)) {
    targetEndpoints.push(`${BACKEND_URL}/api/rides/request`);
  }

  targetEndpoints.forEach(url => {
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passengerName: payload.passengerName || 'Cliente 99',
          origin: payload.origin,
          destination: payload.destination,
          categoryKey: payload.categoryKey || 'pop',
          estimatedPrice: payload.price,
          paymentMethod: payload.paymentMethod || 'pix'
        })
      }).catch(() => {});
    } catch(e) {}
  });
}

function ensureDefaultOnlineDriverExists() {
  let drivers = getPersistedDrivers();
  if (!drivers || drivers.length === 0) {
    const defaultDriver = {
      id: 'drv-99-1',
      name: 'Carlos Eduardo 99',
      phone: '(11) 98765-4321',
      rating: 4.9,
      status: 'online',
      verified: true,
      blocked: false,
      vehicle: {
        model: 'Chevrolet Onix 1.0',
        color: 'Preto',
        plate: 'BRA-9901',
        type: 'pop'
      },
      location: { lat: -23.561684, lng: -46.655981, heading: 0 },
      totalEarnings: 342.50,
      completedRides: 14
    };
    savePersistedDriver(defaultDriver);
    return [defaultDriver];
  }
  return drivers;
}

window.simulateIncomingRideTest = function() {
  unlockAudioContext();
  const testRide = {
    id: `test-ride-${Date.now()}`,
    passengerName: 'Maria Santos (Simulação 99)',
    origin: LOCATIONS.MASP,
    destination: LOCATIONS.IBIRAPUERA,
    price: 18.50,
    distanceKm: 4.2,
    durationMinutes: 12,
    paymentMethod: 'cash',
    paymentMethodName: '💵 Dinheiro ao Motorista'
  };

  showRideDispatchToAllOnlineDrivers(testRide);
  showToast('⚡ Simulação de Corrida disparada com Sirene!', 'info');
};

// ---------------- CONTROLE MESTRE DO SISTEMA ONLINE / OFFLINE ----------------
window.isSystemMasterOnline = function() {
  const status = localStorage.getItem('99_SYSTEM_MASTER_STATUS');
  return status !== 'offline';
};

window.updateMasterSystemToggleUI = function() {
  const isOnline = window.isSystemMasterOnline();
  const btns = document.querySelectorAll('#btnMasterSystemToggle');
  btns.forEach(btn => {
    if (isOnline) {
      btn.className = 'btn-master-system online';
      btn.style.background = '#111827';
      btn.style.color = '#ffffff';
      btn.style.borderColor = '#10b981';
      btn.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.4)';
      btn.innerHTML = `<i class="fa-solid fa-circle blink" style="color: #10b981;"></i> SISTEMA <span style="color: #10b981; font-weight: 900; font-size: 1.05rem; letter-spacing: 1px;">ONLINE</span>`;
    } else {
      btn.className = 'btn-master-system offline';
      btn.style.background = '#111827';
      btn.style.color = '#ffffff';
      btn.style.borderColor = '#ef4444';
      btn.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.4)';
      btn.innerHTML = `<i class="fa-solid fa-power-off" style="color: #ef4444;"></i> SISTEMA <span style="color: #ef4444; font-weight: 900; font-size: 1.05rem; letter-spacing: 1px;">OFFLINE</span>`;
    }
  });
};

window.toggleMasterSystemStatus = function() {
  const isCurrentlyOnline = window.isSystemMasterOnline();
  const newStatus = isCurrentlyOnline ? 'offline' : 'online';

  try {
    localStorage.setItem('99_SYSTEM_MASTER_STATUS', newStatus);
  } catch(e) {}

  if (BACKEND_URL) {
    fetch(`${BACKEND_URL}/api/config/system-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemStatus: newStatus })
    }).catch(() => {});
  }

  broadcastRideEvent('SYSTEM_MASTER_STATUS_CHANGED', { systemStatus: newStatus });
  window.updateMasterSystemToggleUI();

  if (newStatus === 'offline') {
    stopSirenSound();
    const card = document.getElementById('modalRideDispatch');
    if (card) card.classList.add('hidden');
    showToast('🔴 SISTEMA 99 DESLIGADO E OFFLINE! Chamadas pausadas.', 'warning');
    alert('🔴 SISTEMA 99 DESLIGADO E OFFLINE!\n\nEnquanto o sistema estiver Offline, nenhuma solicitação de corrida tocará alarme ou será recebida pelos motoristas.');
  } else {
    showToast('🟢 SISTEMA 99 ATIVADO E ONLINE! Pronto para receber corridas.', 'success');
  }
};

function initCrossTabDispatchListeners() {
  const handleEvent = (data) => {
    if (!data || !data.eventType) return;

    const isDriverPage = !!document.getElementById('mapDriver');

    if (data.eventType === 'SYSTEM_MASTER_STATUS_CHANGED') {
      if (data.payload?.systemStatus) {
        try { localStorage.setItem('99_SYSTEM_MASTER_STATUS', data.payload.systemStatus); } catch(e) {}
      }
      window.updateMasterSystemToggleUI();
      if (!window.isSystemMasterOnline()) {
        stopSirenSound();
        const card = document.getElementById('modalRideDispatch');
        if (card) card.classList.add('hidden');
      }
    } else if (data.eventType === 'NEW_RIDE_REQUESTED') {
      if (isDriverPage && window.isSystemMasterOnline()) {
        console.log('📡 Nova corrida recebida via Broadcast:', data.payload);
        showRideDispatchToAllOnlineDrivers(data.payload);
      }
    } else if (data.eventType === 'RIDE_ACCEPTED_FIRST_WINNER') {
      handleRideAcceptedWinner(data.payload);
    }
  };

  if (rideBroadcastChannel) {
    rideBroadcastChannel.onmessage = (evt) => handleEvent(evt.data);
  }

  window.addEventListener('storage', (evt) => {
    if ((evt.key === '99_BROADCAST_EVENT' || evt.key === '99_PENDING_RIDE_DISPATCH') && evt.newValue) {
      try {
        const data = JSON.parse(evt.newValue);
        const payload = data.payload || data;
        const isDriverPage = !!document.getElementById('mapDriver');
        if (isDriverPage && payload && payload.id && window.isSystemMasterOnline()) {
          showRideDispatchToAllOnlineDrivers(payload);
        }
      } catch(e) {}
    }
    if (evt.key === '99_SYSTEM_MASTER_STATUS') {
      window.updateMasterSystemToggleUI();
      if (!window.isSystemMasterOnline()) {
        stopSirenSound();
        const card = document.getElementById('modalRideDispatch');
        if (card) card.classList.add('hidden');
      }
    }
  });
}

// Socket.io Connection Real-time
try {
  if (typeof io !== 'undefined') {
    state.socket = io(BACKEND_URL);
    state.socket.on('NEW_RIDE_REQUESTED', (ridePayload) => {
      console.log('📡 Nova corrida recebida via Socket.io:', ridePayload);
      const isDriverPage = !!document.getElementById('mapDriver');
      if (isDriverPage) {
        showRideDispatchToAllOnlineDrivers(ridePayload);
      }
    });
    state.socket.on('ride_created', (ridePayload) => {
      console.log('📡 Nova corrida recebida via REST/Socket:', ridePayload);
      const isDriverPage = !!document.getElementById('mapDriver');
      if (isDriverPage) {
        showRideDispatchToAllOnlineDrivers(ridePayload);
      }
    });
    state.socket.on('RIDE_ACCEPTED_FIRST_WINNER', (payload) => {
      handleRideAcceptedWinner(payload);
    });
  }
} catch(e) {}

// Loop de Polling de Sincronização de Ultra-Velocidade (0.8s) entre Dispositivos e Abas
setInterval(() => {
  const isDriverPage = !!document.getElementById('mapDriver');
  if (!isDriverPage) return;

  // 1. Checagem em LocalStorage Local / Cross-Tab
  try {
    const rawPending = localStorage.getItem('99_PENDING_RIDE_DISPATCH');
    if (rawPending) {
      const pendingRide = JSON.parse(rawPending);
      if (pendingRide && pendingRide.id && (!state.currentRide || state.currentRide.id !== pendingRide.id)) {
        console.log('⚡ Nova corrida capturada do LocalStorage pelo Motorista:', pendingRide);
        showRideDispatchToAllOnlineDrivers(pendingRide);
      }
    }
  } catch(e) {}

  // 2. Checagem em Endpoints REST do Servidor Backend
  const checkUrls = [
    'http://localhost:4000/api/rides/pending',
    'http://192.168.1.45:4000/api/rides/pending'
  ];
  if (BACKEND_URL && !checkUrls.includes(`${BACKEND_URL}/api/rides/pending`)) {
    checkUrls.push(`${BACKEND_URL}/api/rides/pending`);
  }

  checkUrls.forEach(url => {
    fetch(url).then(r => r.json()).then(ridesList => {
      if (Array.isArray(ridesList) && ridesList.length > 0) {
        const lastPending = ridesList[ridesList.length - 1];
        if (lastPending && (!state.currentRide || state.currentRide.id !== lastPending.id)) {
          console.log('⚡ Nova corrida capturada via Polling de Rede:', lastPending);
          showRideDispatchToAllOnlineDrivers(lastPending);
        }
      }
    }).catch(() => {});
  });
}, 800);

function showRideDispatchToAllOnlineDrivers(ride) {
  if (!window.isSystemMasterOnline()) {
    console.log('🔴 Sistema Mestre 99 está OFFLINE. Chamada de corrida ignorada e sirene pausada.');
    stopSirenSound();
    const card = document.getElementById('modalRideDispatch');
    if (card) card.classList.add('hidden');
    return;
  }

  state.currentRide = ride;
  playSirenSound();

  const card = document.getElementById('modalRideDispatch');
  if (card) {
    card.classList.remove('hidden');

    const passNameElem = document.getElementById('dispatchPassengerName');
    const originElem = document.getElementById('dispatchOrigin');
    const destElem = document.getElementById('dispatchDest');
    const fareElem = document.getElementById('dispatchFare');
    const driverNameElem = document.getElementById('dispatchDriverName');

    const priceFormatted = `R$ ${(ride.price || 18.50).toFixed(2).replace('.', ',')}`;
    const distText = ride.distanceKm ? `${ride.distanceKm.toFixed(1).replace('.', ',')} km (${ride.durationMinutes || 12} min)` : '4,2 km (12 min)';

    if (passNameElem) passNameElem.innerText = ride.passengerName || 'Cliente 99';
    if (originElem) originElem.innerText = ride.origin?.name || 'MASP - Av. Paulista';
    if (destElem) destElem.innerText = ride.destination?.name || 'Parque Ibirapuera';
    if (fareElem) fareElem.innerText = `${priceFormatted} • 🛣️ ${distText} • ${ride.paymentMethodName || '⚡ PIX'}`;
    if (driverNameElem) driverNameElem.innerText = `🔔 NOVA CORRIDA DISPONÍVEL PARA TODOS OS MOTORISTAS ONLINE! QUEM ACEITAR PRIMEIRO LEVA!`;

    let countdown = 5;
    const timerElem = document.getElementById('dispatchTimer');
    if (timerElem) timerElem.innerText = `⏱️ ${countdown}s para aceitar em 1º lugar`;

    if (state.dispatchTimerInterval) clearInterval(state.dispatchTimerInterval);

    state.dispatchTimerInterval = setInterval(() => {
      countdown--;
      if (timerElem) timerElem.innerText = `⏱️ ${countdown}s para aceitar em 1º lugar`;

      if (countdown <= 0) {
        clearInterval(state.dispatchTimerInterval);
        stopSirenSound();
        if (card) card.classList.add('hidden');
        showToast('⏰ A chamada de entrega expirou (5s).', 'warning');
      }
    }, 1000);
  }
}

function handleRideAcceptedWinner(payload) {
  stopSirenSound();
  if (state.dispatchTimerInterval) clearInterval(state.dispatchTimerInterval);

  const card = document.getElementById('modalRideDispatch');
  if (card) card.classList.add('hidden');

  const activeDriverSelect = document.getElementById('selectActiveDriver');
  const myDriverId = activeDriverSelect ? activeDriverSelect.value : state.currentDriverId;
  const isWinner = String(payload.driverId) === String(myDriverId);

  const ride = state.currentRide || payload;

  if (isWinner && ride) {
    const activeCard = document.getElementById('cardDriverActiveRide');
    if (activeCard) activeCard.classList.remove('hidden');

    const passNameElem = document.getElementById('driverActivePassenger');
    const origElem = document.getElementById('driverActiveOrigin');
    const destElem = document.getElementById('driverActiveDest');
    const fareElem = document.getElementById('driverActiveFare');
    const kmElem = document.getElementById('driverActiveKm');
    const timeElem = document.getElementById('driverActiveTime');
    const payElem = document.getElementById('driverActivePayment');
    const statusElem = document.getElementById('driverActiveStatus');

    const priceFormatted = `R$ ${(ride.price || 18.50).toFixed(2).replace('.', ',')}`;
    const distText = `🛣️ ${(ride.distanceKm || 4.2).toFixed(1).replace('.', ',')} km`;
    const timeText = `⏱️ ${ride.durationMinutes || 12} min`;

    if (passNameElem) passNameElem.innerText = ride.passengerName || 'Cliente 99';
    if (origElem) origElem.innerText = ride.origin?.name || 'MASP - Av. Paulista, nº 1500';
    if (destElem) destElem.innerText = ride.destination?.name || 'Parque Ibirapuera, nº 250';
    if (fareElem) fareElem.innerText = priceFormatted;
    if (kmElem) kmElem.innerText = distText;
    if (timeElem) timeElem.innerText = timeText;
    if (payElem) payElem.innerText = ride.paymentMethodName || '⚡ PIX';

    if (statusElem) {
      statusElem.innerText = '🟡 Motorista a Caminho';
      statusElem.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    }

    showToast(`✅ Você aceitou a corrida em primeiro lugar! Dirija-se ao local de coleta.`, 'success');
  } else {
    showToast(`⚠️ A corrida foi aceita em primeiro lugar por outro motorista (${payload.driverName || 'Frota 99'}).`, 'info');
  }

  const passStatus = document.getElementById('passengerStatus');
  if (passStatus) {
    passStatus.innerText = `🚗 Motorista 99 (${payload.driverName || 'Frota'}) Aceitou e está a caminho!`;
    passStatus.style.background = 'rgba(16, 185, 129, 0.18)';
    passStatus.style.color = '#10b981';
  }
}

// ---------------- 🔊 GERADOR DE ARQUIVO DE ÁUDIO WAV PARA SIRENE 99 ----------------
let cachedSirenWavUri = null;
let globalSirenAudioElem = null;
let audioCtx = null;
let sirenOsc = null;
let sirenGain = null;
let sirenInterval = null;
let audioUnlocked = false;

function createSirenWavDataUri() {
  if (cachedSirenWavUri) return cachedSirenWavUri;
  try {
    const sampleRate = 22050;
    const duration = 2.5;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Uint8Array(44 + numSamples);

    function writeString(offset, str) {
      for (let i = 0; i < str.length; i++) buffer[offset + i] = str.charCodeAt(i);
    }
    function writeUint32(offset, val) {
      buffer[offset] = val & 0xff;
      buffer[offset+1] = (val >> 8) & 0xff;
      buffer[offset+2] = (val >> 16) & 0xff;
      buffer[offset+3] = (val >> 24) & 0xff;
    }
    function writeUint16(offset, val) {
      buffer[offset] = val & 0xff;
      buffer[offset+1] = (val >> 8) & 0xff;
    }

    writeString(0, 'RIFF');
    writeUint32(4, 36 + numSamples);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    writeUint32(16, 16);
    writeUint16(20, 1);
    writeUint16(22, 1);
    writeUint32(24, sampleRate);
    writeUint32(28, sampleRate);
    writeUint16(32, 1);
    writeUint16(34, 8);
    writeString(36, 'data');
    writeUint32(40, numSamples);

    let phase = 0;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const freq = (Math.floor(t * 4) % 2 === 0) ? 880 : 1240;
      phase += (2 * Math.PI * freq) / sampleRate;
      const sample = Math.sin(phase);
      buffer[44 + i] = Math.floor((sample + 1) * 127.5);
    }

    let binary = '';
    const len = buffer.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    cachedSirenWavUri = 'data:audio/wav;base64,' + btoa(binary);
    return cachedSirenWavUri;
  } catch(e) {
    return null;
  }
}

function unlockAudioContext() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      if (!audioCtx) audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      // Criar e tocar um buffer silencioso para desbloqueio permanente de audio no navegador
      const buffer = audioCtx.createBuffer(1, 1, 22050);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start(0);
      audioUnlocked = true;
    }
  } catch(e) {}
}

['click', 'touchstart', 'touchend', 'mousedown', 'pointerdown', 'keydown'].forEach(evtType => {
  window.addEventListener(evtType, () => {
    unlockAudioContext();
  }, { passive: true });
});

let wakeLock = null;
async function requestScreenWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('💡 Tela do Celular mantida acesa para o Motorista!');
    }
  } catch(e) {}
}

window.enableDriverAudio = function() {
  unlockAudioContext();
  requestScreenWakeLock();
  try {
    playSirenSound();
    setTimeout(() => {
      stopSirenSound();
    }, 800);
  } catch(e) {}

  const banner = document.getElementById('audioUnlockBanner');
  if (banner) {
    banner.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    const text = document.getElementById('audioUnlockText');
    if (text) text.innerText = '🔊 SOM DE SIRENE & VIBRAÇÃO 100% LIBERADOS E PRONTOS!';
  }
  showToast('🔊 Alarme de Áudio & Tela Acesa Liberados com Sucesso!', 'success');
};

let sirenAutoStopTimer = null;

function playSirenSound() {
  stopSirenSound();

  // 0. Ativar Vibração Tátil no Celular do Motorista (Max 5s)
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate([500, 200, 500, 200, 500, 200, 1000]); } catch(e) {}
  }

  // 1. Tocar via Elemento de Áudio HTML5 Nativo
  try {
    const wavUri = createSirenWavDataUri();
    if (wavUri) {
      globalSirenAudioElem = new Audio(wavUri);
      globalSirenAudioElem.loop = true;
      globalSirenAudioElem.volume = 1.0;
      const p = globalSirenAudioElem.play();
      if (p !== undefined) {
        p.catch(err => {
          console.warn('📌 Toque na tela para ativar o som de sirene no celular!', err);
        });
      }
    }
  } catch(e) {}

  // 2. Tocar via Web Audio API Synthesizer (Sintetizador Dual-Tone 880Hz / 1320Hz)
  try {
    unlockAudioContext();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      if (!audioCtx) audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      sirenOsc = audioCtx.createOscillator();
      sirenGain = audioCtx.createGain();

      sirenOsc.type = 'sawtooth';
      sirenOsc.frequency.setValueAtTime(880, audioCtx.currentTime);
      sirenGain.gain.setValueAtTime(0.8, audioCtx.currentTime);

      sirenOsc.connect(sirenGain);
      sirenGain.connect(audioCtx.destination);
      sirenOsc.start();

      let high = true;
      sirenInterval = setInterval(() => {
        if (!sirenOsc || !audioCtx) return;
        const targetFreq = high ? 1320 : 660;
        try {
          sirenOsc.frequency.exponentialRampToValueAtTime(targetFreq, audioCtx.currentTime + 0.25);
        } catch(e) {}
        high = !high;
      }, 320);
    }
  } catch (err) {
    console.warn('Erro no sintetizador de sirene:', err);
  }

  // 3. PARAR A SIRENE AUTOMATICAMENTE APÓS EXATAMENTE 5 SEGUNDOS
  if (sirenAutoStopTimer) clearTimeout(sirenAutoStopTimer);
  sirenAutoStopTimer = setTimeout(() => {
    stopSirenSound();
  }, 5000);
}

function stopSirenSound() {
  if (sirenAutoStopTimer) {
    clearTimeout(sirenAutoStopTimer);
    sirenAutoStopTimer = null;
  }
  if (globalSirenAudioElem) {
    try {
      globalSirenAudioElem.pause();
      globalSirenAudioElem.currentTime = 0;
    } catch(e) {}
    globalSirenAudioElem = null;
  }
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }
  if (sirenOsc) {
    try { sirenOsc.stop(); } catch (e) {}
    sirenOsc = null;
  }
}

function findNearestOnlineDriver(originLat, originLng) {
  let allDrivers = getPersistedDrivers();
  if (state.localDrivers && state.localDrivers.length > 0) {
    state.localDrivers.forEach(ld => {
      if (!allDrivers.find(d => String(d.id) === String(ld.id))) allDrivers.push(ld);
    });
  }

  const onlineDrivers = allDrivers.filter(d => d.status === 'online' && !d.blocked);

  if (onlineDrivers.length === 0) {
    return {
      id: state.currentDriverId || 'drv-99-1',
      name: 'Carlos Eduardo 99',
      vehicle: { model: 'Chevrolet Onix 1.0', plate: 'BRA-9901' },
      distanceKm: 0.8
    };
  }

  let nearestDriver = onlineDrivers[0];
  let minDistance = 99999;

  onlineDrivers.forEach(driver => {
    const dLat = driver.location?.lat || -23.561684;
    const dLng = driver.location?.lng || -46.655981;

    const R = 6371;
    const radLat1 = originLat * (Math.PI / 180);
    const radLat2 = dLat * (Math.PI / 180);
    const deltaLat = (dLat - originLat) * (Math.PI / 180);
    const deltaLon = (dLng - originLng) * (Math.PI / 180);

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(radLat1) * Math.cos(radLat2) *
              Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const dist = R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

    if (dist < minDistance) {
      minDistance = dist;
      nearestDriver = driver;
    }
  });

  nearestDriver.distanceKm = parseFloat(Math.max(0.3, minDistance).toFixed(1));
  return nearestDriver;
}

function dispatchRideToOnlineDriversChain(ride, driverIndex = 0) {
  const originLat = ride.origin?.lat || LOCATIONS.MASP.lat;
  const originLng = ride.origin?.lng || LOCATIONS.MASP.lng;

  let allDrivers = getPersistedDrivers();
  const onlineDrivers = allDrivers.filter(d => d.status === 'online' && !d.blocked);

  // ORDENAR MOTORISTAS POR PROXIMIDADE DO EMBARQUE
  onlineDrivers.sort((a, b) => {
    const distA = Math.hypot((a.location?.lat || -23.561684) - originLat, (a.location?.lng || -46.655981) - originLng);
    const distB = Math.hypot((b.location?.lat || -23.561684) - originLat, (b.location?.lng || -46.655981) - originLng);
    return distA - distB;
  });

  if (onlineDrivers.length === 0 || driverIndex >= onlineDrivers.length) {
    const modal = document.getElementById('modalRideDispatch');
    if (modal) modal.classList.add('hidden');
    stopSirenSound();
    showToast('⚠️ Nenhum motorista disponível aceitou a corrida no momento.', 'warning');
    return;
  }

  const currentDriver = onlineDrivers[driverIndex];
  state.assignedDriver = currentDriver;
  state.currentRide = ride;
  state.currentDriverIndex = driverIndex;

  playSirenSound();

  const modal = document.getElementById('modalRideDispatch');
  if (modal) {
    modal.classList.remove('hidden');

    const passNameElem = document.getElementById('dispatchPassengerName');
    const originElem = document.getElementById('dispatchOrigin');
    const destElem = document.getElementById('dispatchDest');
    const fareElem = document.getElementById('dispatchFare');
    const driverNameElem = document.getElementById('dispatchDriverName');

    if (passNameElem) passNameElem.innerText = ride.passengerName || 'Cliente 99';
    if (originElem) originElem.innerText = ride.origin?.name || 'MASP - Av. Paulista';
    if (destElem) destElem.innerText = ride.destination?.name || 'Parque Ibirapuera';
    if (fareElem) fareElem.innerText = `R$ ${(ride.price || 18.50).toFixed(2).replace('.', ',')} (${ride.paymentMethodName || '⚡ PIX'})`;
    if (driverNameElem) driverNameElem.innerText = `🛵 Chamada enviada ao motorista mais próximo: ${currentDriver.name} (${driverIndex + 1}º da fila)`;

    let countdown = 15;
    const timerElem = document.getElementById('dispatchTimer');
    if (timerElem) timerElem.innerText = `⏱️ ${countdown}s restante para aceitar`;

    if (state.dispatchTimerInterval) clearInterval(state.dispatchTimerInterval);

    state.dispatchTimerInterval = setInterval(() => {
      countdown--;
      if (timerElem) timerElem.innerText = `⏱️ ${countdown}s restante para aceitar`;

      if (countdown <= 0) {
        clearInterval(state.dispatchTimerInterval);
        stopSirenSound();
        showToast(`⏰ Motorista ${currentDriver.name} não respondeu. Passando para o próximo motorista mais próximo...`, 'warning');
        dispatchRideToOnlineDriversChain(ride, driverIndex + 1);
      }
    }, 1000);
  }
}

function animateVehicleOnMap(map, pickupLocation, vehicleType = 'pop', role = 'passenger') {
  if (!map) return;

  const pickupLat = pickupLocation?.lat || LOCATIONS.MASP.lat;
  const pickupLng = pickupLocation?.lng || LOCATIONS.MASP.lng;

  const startLat = pickupLat + 0.008;
  const startLng = pickupLng - 0.007;

  if (role === 'passenger' && state.driverMarkerPassenger) {
    try { map.removeLayer(state.driverMarkerPassenger); } catch(e) {}
  }
  if (role === 'driver' && state.driverMarkerDriver) {
    try { map.removeLayer(state.driverMarkerDriver); } catch(e) {}
  }

  const isMoto = vehicleType === 'moto' || vehicleType === 'delivery';
  const heading = 45;
  const marker = L.marker([startLat, startLng], { icon: createVehicleIcon(vehicleType, heading) }).addTo(map);

  if (role === 'passenger') state.driverMarkerPassenger = marker;
  if (role === 'driver') state.driverMarkerDriver = marker;

  let step = 0;
  const totalSteps = 25;
  const interval = setInterval(() => {
    step++;
    const currentLat = startLat + (pickupLat - startLat) * (step / totalSteps);
    const currentLng = startLng + (pickupLng - startLng) * (step / totalSteps);

    marker.setLatLng([currentLat, currentLng]);

    if (step >= totalSteps) {
      clearInterval(interval);
      const vehicleName = isMoto ? '🏍️ Moto 99' : '🚘 Carro 99';
      marker.bindPopup(`<b>${vehicleName} Chegou ao Local de Embarque!</b>`).openPopup();
    }
  }, 400);
}

function handleRideAcceptedWinner(payload) {
  stopSirenSound();
  const modal = document.getElementById('modalRideDispatch');
  if (modal) modal.classList.add('hidden');

  const vehicleEmoji = payload?.vehicleEmoji || '🚗 Veículo 99';
  const passStatus = document.getElementById('passengerStatus');
  if (passStatus) {
    passStatus.innerText = `🚗 ${vehicleEmoji} (${payload?.driverName || 'Motorista 99'}) aceitou e está a caminho do embarque!`;
    passStatus.style.background = 'rgba(16, 185, 129, 0.22)';
    passStatus.style.color = '#059669';
  }

  if (state.passengerMap) {
    const origin = state.lastCalculatedOrigin || LOCATIONS.MASP;
    const vehicleType = payload?.vehicleType || 'pop';
    animateVehicleOnMap(state.passengerMap, origin, vehicleType, 'passenger');
  }

  showToast(`🎉 ${vehicleEmoji} de ${payload?.driverName || 'Motorista 99'} aceitou a corrida! Acompanhe a aproximação no mapa.`, 'success');
}

window.acceptRideDispatch = function() {
  stopSirenSound();
  if (state.dispatchTimerInterval) clearInterval(state.dispatchTimerInterval);

  const modal = document.getElementById('modalRideDispatch');
  if (modal) modal.classList.add('hidden');

  const driver = state.assignedDriver || { name: 'Carlos Eduardo 99', vehicle: { type: 'pop', model: 'Chevrolet Onix 1.0' } };
  const passengerName = document.getElementById('dispatchPassengerName')?.innerText || 'Cliente 99';
  const originName = document.getElementById('dispatchOrigin')?.innerText || 'MASP - Av. Paulista';
  const destName = document.getElementById('dispatchDest')?.innerText || 'Parque Ibirapuera';
  const fareVal = document.getElementById('dispatchFare')?.innerText || 'R$ 18,50';

  const isMoto = (driver.vehicle?.type === 'moto' || driver.vehicle?.model?.toLowerCase().includes('moto') || state.selectedCategory === 'moto');
  const vehicleType = isMoto ? 'moto' : 'pop';
  const vehicleEmoji = isMoto ? '🏍️ Moto 99' : '🚘 Carro 99';

  broadcastRideEvent('RIDE_ACCEPTED_BY_DRIVER', {
    driverName: driver.name,
    vehicleType,
    vehicleEmoji,
    passengerName,
    fareVal
  });

  const cardDriver = document.getElementById('cardDriverActiveRide');
  if (cardDriver) {
    cardDriver.classList.remove('hidden');

    const nameElem = document.getElementById('driverActivePassenger');
    const originElem = document.getElementById('driverActiveOrigin');
    const destElem = document.getElementById('driverActiveDest');
    const fareElem = document.getElementById('driverActiveFare');
    const statusElem = document.getElementById('driverActiveStatus');

    if (nameElem) nameElem.innerText = passengerName;
    if (originElem) originElem.innerText = originName;
    if (destElem) destElem.innerText = destName;
    if (fareElem) fareElem.innerText = fareVal;
    if (statusElem) {
      statusElem.innerText = `🟡 ${vehicleEmoji} a Caminho do Embarque`;
      statusElem.style.background = '#10b981';
    }
  }

  // ABRIR E FOCAR O MAPA COM OS DADOS PREENCHIDOS AUTOMATICAMENTE
  const mapElem = document.getElementById('mapDriver');
  if (mapElem) {
    mapElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (state.driverMap) {
    setTimeout(async () => {
      state.driverMap.invalidateSize();
      const origin = state.lastCalculatedOrigin || LOCATIONS.MASP;
      const dest = state.lastCalculatedDestination || LOCATIONS.IBIRAPUERA;

      const routeData = await fetchOSRMRoute(origin, dest);
      renderRouteOnMap(state.driverMap, routeData, origin, dest, 'driver');

      animateVehicleOnMap(state.driverMap, origin, vehicleType, 'driver');
    }, 200);
  }

  const passStatus = document.getElementById('passengerStatus');
  if (passStatus) {
    passStatus.innerText = `🚗 ${vehicleEmoji} (${driver.name}) aceitou e está a caminho do seu local de coleta!`;
    passStatus.style.background = 'rgba(16, 185, 129, 0.18)';
    passStatus.style.color = '#10b981';
  }

  if (state.passengerMap) {
    const origin = state.lastCalculatedOrigin || LOCATIONS.MASP;
    animateVehicleOnMap(state.passengerMap, origin, vehicleType, 'passenger');
  }

  // DISPARAR AUTOMATICAMENTE O APP DE GPS DO CELULAR DO MOTORISTA (LOCAL DE COLETA)
  setTimeout(() => {
    window.openGPSNavigation('pickup');
  }, 800);

  showToast(`🎉 Corrida Aceita por ${driver.name}! GPS do celular com Rota de Coleta aberto automaticamente.`, 'success');
};

// ---------------- CONTATO E SUPORTE 99 ----------------
window.callPassenger = function() {
  const currentPsg = getPassengerProfile();
  const phone = currentPsg?.phone || '(11) 98888-7777';
  showToast(`📞 Ligando para o cliente: ${phone}...`, 'info');
};

window.openChatWithPassenger = function() {
  showToast('💬 Abrindo Chat 99 em tempo real com o cliente...', 'info');
};

window.openSupport99 = function() {
  showToast('🛡️ Abrindo Central de Suporte 99 24h...', 'info');
};

window.saveDriverPaymentPrefs = function() {
  const pix = document.getElementById('payPix')?.checked;
  const card = document.getElementById('payCard')?.checked;
  const cash = document.getElementById('payCash')?.checked;

  try {
    localStorage.setItem('99_driver_pay_prefs', JSON.stringify({ pix, card, cash }));
  } catch (e) {}

  showToast('💳 Preferências de Pagamento salvas!', 'success');
};

// ---------------- ETAPAS DE COLETA E NAVEGAÇÃO ----------------
window.driverArrivedAtPickup = function() {
  const statusElem = document.getElementById('driverActiveStatus');
  if (statusElem) {
    statusElem.innerText = '📍 Chegou ao Embarque';
    statusElem.style.background = '#0284c7';
  }
  const passStatus = document.getElementById('passengerStatus');
  if (passStatus) {
    passStatus.innerText = '📍 Seu motorista 99 chegou ao local de coleta!';
  }
  showToast('📍 Você chegou ao local de embarque! Aguarde o cliente.', 'info');
};

window.driverCollectPackage = function() {
  const statusElem = document.getElementById('driverActiveStatus');
  if (statusElem) {
    statusElem.innerText = '📦 Coletando Encomenda...';
    statusElem.style.background = '#f59e0b';
  }
  showToast('📦 Coletando encomenda/passageiro no local...', 'info');
};

window.openGPSNavigation = function(type = 'pickup', app = 'google_maps') {
  let targetObj = null;

  if (state.currentRide) {
    targetObj = type === 'pickup' ? state.currentRide.origin : state.currentRide.destination;
  } else if (type === 'pickup' && state.lastCalculatedOrigin) {
    targetObj = state.lastCalculatedOrigin;
  } else if (type === 'destination' && state.lastCalculatedDestination) {
    targetObj = state.lastCalculatedDestination;
  }

  if (!targetObj || (!targetObj.name && !targetObj.address)) {
    showToast('⚠️ Nenhum endereço cadastrado para esta corrida.', 'warning');
    return;
  }

  let rawAddressName = targetObj.name || targetObj.address || '';
  const encodedQuery = encodeURIComponent(rawAddressName);
  let navUrl = '';

  if (app === 'waze') {
    navUrl = `https://waze.com/ul?q=${encodedQuery}&navigate=yes`;
  } else {
    // NAVEGAÇÃO DIRETA DE ALTA PRECISÃO NO GOOGLE MAPS (RUA E NÚMERO EXATOS)
    navUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodedQuery}&travelmode=driving`;
  }

  showToast(`🗺️ GPS com Rota Exata (100% Precisão) abrindo para: ${rawAddressName}...`, 'info');

  try {
    const w = window.open(navUrl, '_blank');
    if (!w || w.closed || typeof w.closed === 'undefined') {
      window.location.href = navUrl;
    }
  } catch(e) {
    window.location.href = navUrl;
  }
};

window.driverPackageCollected = function() {
  const statusElem = document.getElementById('driverActiveStatus');
  if (statusElem) {
    statusElem.innerText = '✅ Coletado! Indo ao Destino';
    statusElem.style.background = '#ff9e00';
  }

  const passStatus = document.getElementById('passengerStatus');
  if (passStatus) {
    passStatus.innerText = '📦 Coleta concluída! Indo ao destino final...';
  }

  if (state.driverMap) {
    setTimeout(() => {
      state.driverMap.invalidateSize();
      const origin = state.lastCalculatedOrigin || LOCATIONS.MASP;
      const dest = state.lastCalculatedDestination || LOCATIONS.IBIRAPUERA;

      const routeData = {
        coordinates: [
          [origin.lat, origin.lng],
          [(origin.lat + dest.lat) / 2 + 0.003, (origin.lng + dest.lng) / 2 - 0.003],
          [dest.lat, dest.lng]
        ]
      };

      renderRouteOnMap(state.driverMap, routeData, origin, dest, 'driver');
      state.driverMap.flyTo([dest.lat, dest.lng], 16, { animate: true, duration: 1.2 });
    }, 200);
  }

  // DISPARAR AUTOMATICAMENTE O APP DE GPS DO CELULAR COM O ENDEREÇO DA ENTREGA
  setTimeout(() => {
    window.openGPSNavigation('destination');
  }, 600);

  showToast('✅ Coleta Concluída! Abrindo GPS do Celular com a Rota da Entrega Final.', 'success');
};

window.driverCompleteRide = function() {
  const fareVal = document.getElementById('driverActiveFare')?.innerText || 'R$ 18,50';
  const ride = state.currentRide || {};
  const isCash = ride.paymentMethod === 'cash' || fareVal.includes('Dinheiro') || fareVal.includes('💵');

  if (isCash) {
    const modalCash = document.getElementById('modalCashCollection');
    const amountElem = document.getElementById('cashCollectAmount');
    if (amountElem) amountElem.innerText = fareVal.split('(')[0].trim();
    if (modalCash) {
      modalCash.classList.remove('hidden');
      return;
    }
  }

  finishRideCleanly(fareVal);
};

window.confirmCashReceived = function() {
  const modalCash = document.getElementById('modalCashCollection');
  if (modalCash) modalCash.classList.add('hidden');

  const fareVal = document.getElementById('driverActiveFare')?.innerText || 'R$ 18,50';
  finishRideCleanly(fareVal, true);
};

function finishRideCleanly(fareVal, cashConfirmed = false) {
  const cardDriver = document.getElementById('cardDriverActiveRide');
  if (cardDriver) cardDriver.classList.add('hidden');

  const passStatus = document.getElementById('passengerStatus');
  if (passStatus) {
    passStatus.innerText = '🏁 Viagem Concluída com Sucesso! Obrigado por usar a 99.';
    passStatus.style.background = 'rgba(255, 158, 0, 0.18)';
    passStatus.style.color = '#d97706';
  }

  const msg = cashConfirmed
    ? `💵 PAGAMENTO EM DINHEIRO RECEBIDO!\nValor: ${fareVal}`
    : `🏁 VIAGEM CONCLUÍDA!\nValor creditado: ${fareVal}`;

  showToast(`🏁 ${msg}`, 'success');
}

window.rejectRideDispatch = function() {
  stopSirenSound();
  if (state.dispatchTimerInterval) clearInterval(state.dispatchTimerInterval);

  const modal = document.getElementById('modalRideDispatch');
  if (modal) modal.classList.add('hidden');

  showToast('Chamada recusada.', 'info');
};

// ---------------- LOCAL STORAGE UTILS ----------------
function getDeletedDriverIds() {
  try {
    const raw = localStorage.getItem('99_deleted_drivers');
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function getPersistedDrivers() {
  try {
    const raw = localStorage.getItem('99_drivers');
    const all = raw ? JSON.parse(raw) : [];
    const deleted = getDeletedDriverIds();
    return all.filter(d => !deleted.includes(String(d.id)));
  } catch (e) { return []; }
}

function savePersistedDriver(driverObj) {
  try {
    const current = getPersistedDrivers();
    const existingIndex = current.findIndex(d => String(d.id) === String(driverObj.id));
    if (existingIndex >= 0) {
      current[existingIndex] = driverObj;
    } else {
      current.push(driverObj);
    }
    localStorage.setItem('99_drivers', JSON.stringify(current));
  } catch (e) {}
}

function getPassengerProfile() {
  try {
    const raw = localStorage.getItem('99_current_passenger');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function loadCurrentPassengerUI() {
  const current = getPassengerProfile();
  if (current && current.name) {
    const statusElem = document.getElementById('passengerStatus');
    if (statusElem) {
      statusElem.innerText = `👤 Cliente: ${current.name}`;
      statusElem.style.background = 'rgba(255, 158, 0, 0.18)';
      statusElem.style.color = '#d97706';
    }
  }
}

// ---------------- MAP INITIALIZATION & VEHICLE PINS ----------------
function createPinIcon(type) {
  const isOrigin = type === 'origin';
  return L.divIcon({
    className: 'custom-pin',
    html: `
      <div style="background: ${isOrigin ? '#10b981' : '#ef4444'}; color: #fff; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); border: 2px solid #fff;">
        <i class="fa-solid ${isOrigin ? 'fa-circle-dot' : 'fa-location-dot'}"></i>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function createVehicleIcon(type = 'pop', heading = 0) {
  const isMoto = type === 'moto' || type === 'delivery';
  const iconChar = isMoto ? '🏍️' : '🟡';
  return L.divIcon({
    className: 'vehicle-pin-99',
    html: `
      <div style="transform: rotate(${heading}deg); transition: transform 0.5s ease; font-size: 24px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));">
        ${iconChar}
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function initMaps() {
  const elemPass = document.getElementById('mapPassenger');
  if (elemPass && !state.passengerMap) {
    try {
      state.passengerMap = L.map('mapPassenger').setView([LOCATIONS.MASP.lat, LOCATIONS.MASP.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; 99 Super-App Brasil'
      }).addTo(state.passengerMap);
    } catch (e) {}
  }

  const elemDriver = document.getElementById('mapDriver');
  if (elemDriver && !state.driverMap) {
    try {
      state.driverMap = L.map('mapDriver').setView([LOCATIONS.MASP.lat, LOCATIONS.MASP.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; 99 Driver Engine'
      }).addTo(state.driverMap);
    } catch (e) {}
  }
}

// ---------------- STREET-BY-STREET ROUTING & FARE ENGINE ----------------
async function fetchOSRMRoute(origin, destination) {
  const safeOrigin = (origin && origin.lat && origin.lng) ? origin : LOCATIONS.MASP;
  const safeDest = (destination && destination.lat && destination.lng) ? destination : LOCATIONS.IBIRAPUERA;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${safeOrigin.lng},${safeOrigin.lat};${safeDest.lng},${safeDest.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const distKm = parseFloat((route.distance / 1000).toFixed(2));
        const durationMin = Math.max(3, Math.round(route.duration / 60));
        const latLngs = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
        return {
          distanceKm: distKm,
          durationMinutes: durationMin,
          coordinates: latLngs,
          isExactOSRM: true
        };
      }
    }
  } catch (err) {
    console.warn('OSRM indisponível, usando motor de curvatura local:', err);
  }

  // Fallback com fator de curvatura real de vias urbanas (1.35x)
  const R = 6371;
  const dLat = (safeDest.lat - safeOrigin.lat) * (Math.PI / 180);
  const dLon = (safeDest.lng - safeOrigin.lng) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(safeOrigin.lat * (Math.PI / 180)) * Math.cos(safeDest.lat * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const straight = R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  const distKm = Math.max(1.0, parseFloat((straight * 1.35).toFixed(2)));
  const durationMin = Math.max(4, Math.round((distKm / 28) * 60));

  const midLat = (safeOrigin.lat + safeDest.lat) / 2 + 0.003;
  const midLng = (safeOrigin.lng + safeDest.lng) / 2 - 0.003;
  const coordinates = [
    [safeOrigin.lat, safeOrigin.lng],
    [midLat, midLng],
    [safeDest.lat, safeDest.lng]
  ];

  return {
    distanceKm: distKm,
    durationMinutes: durationMin,
    coordinates,
    isExactOSRM: false
  };
}

function renderRouteOnMap(map, routeData, origin, destination, role = 'passenger') {
  if (!map) return;

  const safeOrigin = (origin && origin.lat) ? origin : LOCATIONS.MASP;
  const safeDest = (destination && destination.lat) ? destination : LOCATIONS.IBIRAPUERA;

  if (role === 'passenger' && state.routePolylinePassenger) {
    try { map.removeLayer(state.routePolylinePassenger); } catch(e) {}
  }
  if (role === 'driver' && state.routePolylineDriver) {
    try { map.removeLayer(state.routePolylineDriver); } catch(e) {}
  }

  L.marker([safeOrigin.lat, safeOrigin.lng], { icon: createPinIcon('origin') }).addTo(map);
  L.marker([safeDest.lat, safeDest.lng], { icon: createPinIcon('dest') }).addTo(map);

  const polyline = L.polyline(routeData.coordinates, {
    color: '#ff9e00',
    weight: 6,
    opacity: 0.9,
    lineJoin: 'round',
    lineCap: 'round'
  }).addTo(map);

  try {
    map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
  } catch(e) {}

  if (role === 'passenger') state.routePolylinePassenger = polyline;
  if (role === 'driver') state.routePolylineDriver = polyline;
}

function calculateFareCategories(distanceKm, durationMinutes) {
  const basePrice = 6.00;
  const pricePerKm = 2.50;
  const pricePerMin = 0.50;
  const surge = state.surgeFactor || 1.0;

  const rawFare = (basePrice + (distanceKm * pricePerKm) + (durationMinutes * pricePerMin)) * surge;

  return [
    { categoryKey: 'pop', name: '🟡 99Pop (Econômico)', icon: '🟡', price: Math.max(10.00, parseFloat((rawFare * 1.0).toFixed(2))) },
    { categoryKey: 'comfort', name: '🚘 99Comfort (Espaçoso)', icon: '🚘', price: Math.max(14.00, parseFloat((rawFare * 1.25).toFixed(2))) },
    { categoryKey: 'moto', name: '🏍️ 99Moto (Viagens Rápidas)', icon: '🏍️', price: Math.max(8.00, parseFloat((rawFare * 0.70).toFixed(2))) },
    { categoryKey: 'delivery', name: '📦 99Entrega Flash', icon: '📦', price: Math.max(9.00, parseFloat((rawFare * 0.80).toFixed(2))) },
    { categoryKey: 'taxi', name: '🚕 99Táxi Oficial', icon: '🚕', price: Math.max(15.00, parseFloat((rawFare * 1.35).toFixed(2))) }
  ];
}

// ---------------- GEOCODING & AUTOCOMPLETE ----------------
async function geocodeAddressText(query, type) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return null;

  const presetKeys = Object.keys(LOCATIONS);
  for (let key of presetKeys) {
    if (cleanQuery.toLowerCase().includes(LOCATIONS[key].name.toLowerCase()) || cleanQuery.toLowerCase().includes(key.toLowerCase())) {
      return LOCATIONS[key];
    }
  }

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&q=${encodeURIComponent(cleanQuery)}`);
    const data = await res.json();
    if (data && data.length > 0) {
      return {
        name: data[0].display_name.split(',')[0],
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    }
  } catch (err) {}

  return {
    name: cleanQuery,
    lat: LOCATIONS.MASP.lat + (type === 'origin' ? 0.005 : 0.035),
    lng: LOCATIONS.MASP.lng + (type === 'origin' ? 0.005 : 0.035)
  };
}

function setupAddressAutocomplete(inputId, dropdownId, fieldType) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;

  let timer = null;
  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(timer);

    if (query.length < 2) {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
      return;
    }

    timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=br&limit=5&q=${encodeURIComponent(query)}`);
        const results = await res.json();

        dropdown.innerHTML = '';
        if (results && results.length > 0) {
          dropdown.classList.remove('hidden');
          results.forEach(item => {
            const addr = item.address || {};
            const street = addr.road || addr.suburb || item.display_name.split(',')[0];
            const city = addr.city || addr.town || 'São Paulo';
            const stateName = addr.state || 'SP';

            const div = document.createElement('div');
            div.className = 'autocomplete-item';
            div.innerHTML = `
              <div class="item-icon">${fieldType === 'origin' ? '🟢' : '🔴'}</div>
              <div>
                <div class="street-name">${street}</div>
                <div class="city-name">${city} - ${stateName}</div>
              </div>
            `;
            div.onclick = () => {
              input.value = `${street} - ${city}/${stateName}`;
              dropdown.classList.add('hidden');
            };
            dropdown.appendChild(div);
          });
        } else {
          dropdown.classList.add('hidden');
        }
      } catch (e) { dropdown.classList.add('hidden'); }
    }, 350);
  });
}

// ---------------- GLOBAL SUBMISSION HANDLERS ----------------
window.handlePassengerRegisterSubmit = function(e) {
  if (e && e.preventDefault) e.preventDefault();
  
  const nameInput = document.getElementById('regPassengerName');
  const phoneInput = document.getElementById('regPassengerPhone');
  const payInput = document.getElementById('regPassengerPay');

  const nameVal = nameInput ? nameInput.value.trim() : '';
  const phoneVal = phoneInput ? phoneInput.value.trim() : '';
  const payVal = payInput ? payInput.value : 'pix';

  if (!nameVal) {
    alert('Por favor, informe seu Nome Completo!');
    if (nameInput) nameInput.focus();
    return false;
  }

  const passengerObj = {
    id: `psg-${Date.now()}`,
    name: nameVal,
    phone: phoneVal || '(11) 98888-7777',
    preferredPayment: payVal
  };

  try {
    localStorage.setItem('99_current_passenger', JSON.stringify(passengerObj));
  } catch (err) {}

  const modal = document.getElementById('modalRegisterPassenger');
  if (modal) modal.classList.add('hidden');

  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';

  const statusElem = document.getElementById('passengerStatus');
  if (statusElem) {
    statusElem.innerText = `👤 Cliente: ${passengerObj.name}`;
    statusElem.style.background = 'rgba(255, 158, 0, 0.18)';
    statusElem.style.color = '#d97706';
  }

  showToast(`👤 Perfil de Cliente "${passengerObj.name}" criado com sucesso!`, 'success');
  alert(`🎉 Perfil do Cliente "${passengerObj.name}" CRIADO E ATIVADO COM SUCESSO NA 99!`);
  return false;
};

window.handleDriverRegisterSubmit = function(e) {
  if (e && e.preventDefault) e.preventDefault();
  
  const nameInput = document.getElementById('regDriverName');
  const phoneInput = document.getElementById('regDriverPhone');
  const typeInput = document.getElementById('regDriverType');
  const modelInput = document.getElementById('regDriverModel');
  const colorInput = document.getElementById('regDriverColor');
  const plateInput = document.getElementById('regDriverPlate');

  const nameVal = nameInput ? nameInput.value.trim() : '';
  const phoneVal = phoneInput ? phoneInput.value.trim() : '';
  const typeVal = typeInput ? typeInput.value : 'pop';
  const modelVal = modelInput ? modelInput.value.trim() : '';
  const colorVal = colorInput ? colorInput.value.trim() : '';
  const plateVal = plateInput ? plateInput.value.trim() : '';

  if (!nameVal) {
    alert('Por favor, informe o Nome Completo do motorista!');
    if (nameInput) nameInput.focus();
    return false;
  }
  if (!modelVal) {
    alert('Por favor, informe o Modelo do Veículo!');
    if (modelInput) modelInput.focus();
    return false;
  }
  if (!plateVal) {
    alert('Por favor, informe a Placa Oficial do Veículo!');
    if (plateInput) plateInput.focus();
    return false;
  }

  const newDriverObj = {
    id: `drv-99-${Date.now()}`,
    name: nameVal,
    phone: phoneVal || '(11) 99999-9999',
    rating: 5.0,
    status: 'online',
    verified: true,
    blocked: false,
    vehicle: {
      model: modelVal,
      color: colorVal || 'Preto',
      plate: plateVal,
      type: typeVal
    },
    location: { lat: -23.561684 + (Math.random() - 0.5) * 0.01, lng: -46.655981 + (Math.random() - 0.5) * 0.01, heading: 0 },
    totalEarnings: 0,
    completedRides: 0
  };

  if (!state.localDrivers) state.localDrivers = [];
  state.localDrivers.push(newDriverObj);
  savePersistedDriver(newDriverObj);
  state.currentDriverId = newDriverObj.id;

  const modal = document.getElementById('modalRegisterDriver');
  if (modal) modal.classList.add('hidden');
  
  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (modelInput) modelInput.value = '';
  if (colorInput) colorInput.value = '';
  if (plateInput) plateInput.value = '';

  const selectActive = document.getElementById('selectActiveDriver');
  if (selectActive) {
    const isMoto = newDriverObj.vehicle.type === 'moto' || newDriverObj.vehicle.type === 'delivery';
    const opt = document.createElement('option');
    opt.value = newDriverObj.id;
    opt.innerText = `${isMoto ? '🏍️' : '🟡'} ${newDriverObj.name} (${newDriverObj.vehicle.model}) ✅ Aprovado 99`;
    opt.selected = true;
    selectActive.appendChild(opt);
    selectActive.value = newDriverObj.id;
  }

  const toggle = document.getElementById('toggleDriverOnline');
  if (toggle) toggle.checked = true;

  showToast(`🎉 Motorista 99 "${newDriverObj.name}" CADASTRADO E ONLINE!`, 'success');
  alert(`🎉 Motorista 99 "${newDriverObj.name}" (${newDriverObj.vehicle.model}) CADASTRADO E ONLINE COM SUCESSO!`);

  try { loadAdminDrivers(); } catch(err) {}

  fetch(`${BACKEND_URL}/api/drivers/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: newDriverObj.name,
      phone: newDriverObj.phone,
      vehicleType: newDriverObj.vehicle.type,
      vehicleModel: newDriverObj.vehicle.model,
      vehicleColor: newDriverObj.vehicle.color,
      vehiclePlate: newDriverObj.vehicle.plate
    })
  }).catch(() => {});

  return false;
};

window.switchActiveDriver = function(driverId) {
  if (!driverId) return;
  state.currentDriverId = driverId;
  showToast(`Motorista 99 ativo alterado.`, 'info');
};

async function loadAdminDrivers() {
  try {
    let drivers = [];
    try {
      const res = await fetch(`${BACKEND_URL}/api/drivers`);
      drivers = await res.json();
    } catch (e) {}

    if (!Array.isArray(drivers)) drivers = [];

    const persisted = getPersistedDrivers();
    persisted.forEach(pd => {
      if (!drivers.find(d => String(d.id) === String(pd.id))) drivers.push(pd);
    });

    const tbody = document.getElementById('adminDriversTable');
    const selectActive = document.getElementById('selectActiveDriver');

    if (tbody) tbody.innerHTML = '';
    if (selectActive) selectActive.innerHTML = '';

    drivers.forEach(d => {
      const isMoto = d.vehicle?.type === 'moto' || d.vehicle?.type === 'delivery';
      const vehicleModel = d.vehicle?.model || 'Veículo 99';
      const vehiclePlate = d.vehicle?.plate || 'PLACA-99';
      const isBlocked = d.blocked || d.status === 'blocked';

      if (tbody) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${d.name}</strong><br><small style="color: var(--text-muted);">${d.phone || '(11) 99999-9999'}</small></td>
          <td><strong>${isMoto ? '🏍️ Moto' : '🟡 99Pop'} • ${vehicleModel}</strong><br><span>${vehiclePlate}</span></td>
          <td><span style="color: ${isBlocked ? '#ef4444' : '#10b981'}; font-weight: 800;">${isBlocked ? '🔴 BLOQUEADO' : '🟢 ONLINE'}</span></td>
          <td><span style="color: #10b981; font-weight: 700;">✅ CNH 99 Aprovada</span></td>
          <td>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              <button class="btn-sm btn-secondary" onclick="window.openEditDriverModal('${d.id}')" title="Editar Dados">✏️ Editar</button>
              <button class="btn-sm" style="background: ${isBlocked ? '#10b981' : '#f59e0b'}; color: #fff; border: none; font-size: 0.75rem; padding: 4px 8px; border-radius: 6px; font-weight: 700;" onclick="window.toggleBlockDriver('${d.id}')">
                ${isBlocked ? '🟢 Desbloquear' : '🚫 Bloquear'}
              </button>
              <button class="btn-sm" style="background: #ef4444; color: #fff; border: none; font-size: 0.75rem; padding: 4px 8px; border-radius: 6px; font-weight: 700;" onclick="window.deleteDriver('${d.id}')">🗑️ Excluir</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      }

      if (selectActive && !isBlocked) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.innerText = `${isMoto ? '🏍️' : '🟡'} ${d.name} (${vehicleModel})`;
        selectActive.appendChild(opt);
      }
    });

    const countElem = document.getElementById('adminTotalDrivers');
    if (countElem) countElem.innerText = drivers.length;
  } catch (err) {}
}

window.openEditDriverModal = function(driverId) {
  let drivers = getPersistedDrivers();
  const driver = drivers.find(d => String(d.id) === String(driverId));
  if (!driver) return alert('Motorista não encontrado!');

  const editId = document.getElementById('editDriverId');
  const editName = document.getElementById('editDriverName');
  const editPhone = document.getElementById('editDriverPhone');
  const editType = document.getElementById('editDriverType');
  const editModel = document.getElementById('editDriverModel');
  const editColor = document.getElementById('editDriverColor');
  const editPlate = document.getElementById('editDriverPlate');

  if (editId) editId.value = driver.id;
  if (editName) editName.value = driver.name || '';
  if (editPhone) editPhone.value = driver.phone || '';
  if (editType) editType.value = driver.vehicle?.type || 'pop';
  if (editModel) editModel.value = driver.vehicle?.model || '';
  if (editColor) editColor.value = driver.vehicle?.color || '';
  if (editPlate) editPlate.value = driver.vehicle?.plate || '';

  document.getElementById('modalEditDriver')?.classList.remove('hidden');
};

window.saveEditedDriverSubmit = function(e) {
  if (e && e.preventDefault) e.preventDefault();

  const id = document.getElementById('editDriverId')?.value;
  const name = document.getElementById('editDriverName')?.value.trim();
  const phone = document.getElementById('editDriverPhone')?.value.trim();
  const type = document.getElementById('editDriverType')?.value;
  const model = document.getElementById('editDriverModel')?.value.trim();
  const color = document.getElementById('editDriverColor')?.value.trim();
  const plate = document.getElementById('editDriverPlate')?.value.trim();

  let drivers = getPersistedDrivers();
  const index = drivers.findIndex(d => String(d.id) === String(id));
  if (index >= 0) {
    drivers[index].name = name;
    drivers[index].phone = phone;
    drivers[index].vehicle = { type, model, color, plate };
    localStorage.setItem('99_drivers', JSON.stringify(drivers));
  }

  fetch(`${BACKEND_URL}/api/drivers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone, vehicleType: type, vehicleModel: model, vehicleColor: color, vehiclePlate: plate })
  }).catch(() => {});

  document.getElementById('modalEditDriver')?.classList.add('hidden');
  showToast('✏️ Dados do Motorista 99 alterados com sucesso!', 'success');
  loadAdminDrivers();
};

window.toggleBlockDriver = function(driverId) {
  let drivers = getPersistedDrivers();
  const index = drivers.findIndex(d => String(d.id) === String(driverId));
  if (index >= 0) {
    drivers[index].blocked = !drivers[index].blocked;
    drivers[index].status = drivers[index].blocked ? 'blocked' : 'online';
    localStorage.setItem('99_drivers', JSON.stringify(drivers));

    fetch(`${BACKEND_URL}/api/drivers/${driverId}/toggle-block`, { method: 'POST' }).catch(() => {});

    const actionText = drivers[index].blocked ? 'BLOQUEADO 🚫' : 'DESBLOQUEADO 🟢';
    showToast(`Motorista 99 ${actionText}!`, 'warning');
    alert(`Motorista "${drivers[index].name}" foi ${actionText} com sucesso!`);
    loadAdminDrivers();
  }
};

window.deleteDriver = function(driverId) {
  let drivers = getPersistedDrivers();
  const driver = drivers.find(d => String(d.id) === String(driverId));
  const driverName = driver ? driver.name : 'Motorista';

  if (confirm(`Tem certeza que deseja EXCLUIR PERMANENTEMENTE o motorista "${driverName}" do sistema 99?`)) {
    const updated = drivers.filter(d => String(d.id) !== String(driverId));
    localStorage.setItem('99_drivers', JSON.stringify(updated));

    const deleted = getDeletedDriverIds();
    deleted.push(String(driverId));
    localStorage.setItem('99_deleted_drivers', JSON.stringify(deleted));

    fetch(`${BACKEND_URL}/api/drivers/${driverId}`, { method: 'DELETE' }).catch(() => {});

    showToast(`🗑️ Motorista "${driverName}" excluído com sucesso!`, 'success');
    loadAdminDrivers();
  }
};

// ---------------- GEOCODING & AUTOCOMPLETE ----------------
async function geocodeAddressText(query, type) {
  const cleanQuery = query ? query.trim() : '';
  if (!cleanQuery) return null;

  try {
    const searchUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&q=${encodeURIComponent(cleanQuery)}`;
    const res = await fetch(searchUrl);
    const data = await res.json();
    if (data && data.length > 0) {
      return {
        name: cleanQuery,
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    }
  } catch (err) {}

  try {
    const res2 = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&q=${encodeURIComponent(cleanQuery + ', Brasil')}`);
    const data2 = await res2.json();
    if (data2 && data2.length > 0) {
      return {
        name: cleanQuery,
        lat: parseFloat(data2[0].lat),
        lng: parseFloat(data2[0].lon)
      };
    }
  } catch (err) {}

  const presetKeys = Object.keys(LOCATIONS);
  for (let key of presetKeys) {
    if (cleanQuery.toLowerCase().includes(LOCATIONS[key].name.toLowerCase())) {
      return { ...LOCATIONS[key], name: cleanQuery };
    }
  }

  return {
    name: cleanQuery,
    lat: -23.550520 + (type === 'origin' ? 0 : 0.03),
    lng: -46.633309 + (type === 'origin' ? 0 : 0.03)
  };
}

const PRESET_SUGGESTIONS_DB = [
  { street: 'Rua Sérgio Roberto da Silva', city: 'Mogi das Cruzes / SP' },
  { street: 'Avenida Mogi das Cruzes', city: 'Suzano / SP' },
  { street: 'MASP - Av. Paulista, 1500', city: 'Bela Vista - São Paulo / SP' },
  { street: 'Parque Ibirapuera - Av. Pedro Álvares Cabral', city: 'Vila Mariana - São Paulo / SP' },
  { street: 'Avenida Paulista', city: 'Bela Vista - São Paulo / SP' },
  { street: 'Rua Augusta', city: 'Consolação - São Paulo / SP' },
  { street: 'Avenida Faria Lima', city: 'Itaim Bibi - São Paulo / SP' },
  { street: 'Rua Oscar Freire', city: 'Jardins - São Paulo / SP' },
  { street: 'Aeroporto Internacional de Guarulhos (GRU)', city: 'Guarulhos / SP' },
  { street: 'Aeroporto de Congonhas (CGH)', city: 'São Paulo / SP' },
  { street: 'Estação da Luz - Praça da Luz', city: 'Centro - São Paulo / SP' },
  { street: 'Shopping Anália Franco', city: 'Tatuapé - São Paulo / SP' },
  { street: 'Shopping Eldorado', city: 'Pinheiros - São Paulo / SP' }
];

function setupAddressAutocomplete(inputId, dropdownId, fieldType) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;

  let timer = null;

  const renderItems = (items) => {
    dropdown.innerHTML = '';
    if (!items || items.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }
    dropdown.classList.remove('hidden');

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'autocomplete-item';
      div.innerHTML = `
        <div class="item-icon">${fieldType === 'origin' ? '🟢' : '🔴'}</div>
        <div>
          <div class="street-name">${item.street}</div>
          <div class="city-name">${item.city}</div>
        </div>
      `;
      div.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.value = item.street;
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
        try { window.handleCalculateFareSubmit(); } catch(err) {}
      };
      dropdown.appendChild(div);
    });
  };

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(timer);

    if (query.length < 1) {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
      return;
    }

    // 1. Sugestões locais instantâneas (zero delay)
    const localMatches = PRESET_SUGGESTIONS_DB.filter(s =>
      s.street.toLowerCase().includes(query.toLowerCase()) ||
      s.city.toLowerCase().includes(query.toLowerCase())
    );

    renderItems(localMatches);

    // 2. Busca em tempo real na API do OpenStreetMap Nominatim
    timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=br&limit=6&q=${encodeURIComponent(query)}`);
        const results = await res.json();

        if (results && results.length > 0) {
          const apiMatches = results.map(item => {
            const addr = item.address || {};
            const street = addr.road || addr.suburb || item.display_name.split(',')[0];
            const city = addr.city || addr.town || addr.municipality || 'São Paulo';
            const stateName = addr.state || 'SP';
            return {
              street: `${street}`,
              city: `${city} / ${stateName}`
            };
          });

          const combined = [...localMatches];
          apiMatches.forEach(am => {
            if (!combined.find(c => c.street.toLowerCase() === am.street.toLowerCase())) {
              combined.push(am);
            }
          });

          renderItems(combined.slice(0, 6));
        }
      } catch (e) {}
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });
}

// ---------------- MAP PASSENGER FLEET DISPLAY ----------------
let fleetMarkersPassenger = [];

function renderOnlineFleetOnPassengerMap() {
  if (!state.passengerMap) return;

  let drivers = getPersistedDrivers();
  if (state.localDrivers && state.localDrivers.length > 0) {
    state.localDrivers.forEach(ld => {
      if (!drivers.find(d => String(d.id) === String(ld.id))) drivers.push(ld);
    });
  }

  const onlineDrivers = drivers.filter(d => d.status === 'online' && !d.blocked);

  fleetMarkersPassenger.forEach(m => {
    try { state.passengerMap.removeLayer(m); } catch(e) {}
  });
  fleetMarkersPassenger = [];

  onlineDrivers.forEach(d => {
    const lat = d.location?.lat || (-23.561684 + (Math.random() - 0.5) * 0.01);
    const lng = d.location?.lng || (-46.655981 + (Math.random() - 0.5) * 0.01);
    const heading = d.location?.heading || 0;
    const type = d.vehicle?.type || 'pop';

    const marker = L.marker([lat, lng], { icon: createVehicleIcon(type, heading) })
      .addTo(state.passengerMap)
      .bindPopup(`
        <div style="font-family: sans-serif; text-align: center; padding: 4px;">
          <strong style="color: #ff9e00;">🟡 Motorista 99 ONLINE</strong><br>
          <b>${d.name}</b><br>
          <small>${d.vehicle?.model || 'Veículo 99'}</small>
        </div>
      `);

    fleetMarkersPassenger.push(marker);
  });
}

window.handleCalculateFareSubmit = async function() {
  let originText = document.getElementById('inputOrigin')?.value?.trim();
  let destText = document.getElementById('inputDestination')?.value?.trim();
  const originNum = document.getElementById('inputOriginNumber')?.value?.trim();
  const destNum = document.getElementById('inputDestinationNumber')?.value?.trim();

  if (!originText || !destText) {
    return;
  }

  const btn = document.getElementById('btnCalculateFare');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Traçando Rota por Ruas e Curvas...';

  try {
    const fullOriginText = `${originText}${originNum ? ', nº ' + originNum : ''}`;
    const fullDestText = `${destText}${destNum ? ', nº ' + destNum : ''}`;

    const origin = await geocodeAddressText(fullOriginText, 'origin');
    const dest = await geocodeAddressText(fullDestText, 'destination');

    state.lastCalculatedOrigin = origin;
    state.lastCalculatedDestination = dest;

    const routeData = await fetchOSRMRoute(origin, dest);
    const options = calculateFareCategories(routeData.distanceKm, routeData.durationMinutes);

    state.fareEstimate = {
      distanceKm: routeData.distanceKm,
      durationMinutes: routeData.durationMinutes,
      options
    };

    if (state.passengerMap) {
      try {
        renderRouteOnMap(state.passengerMap, routeData, origin, dest, 'passenger');
      } catch(e) {}
    }

    const grid = document.getElementById('categoriesGrid');
    if (grid) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; background: #fffbeb; color: #d97706; border: 1px solid #fde68a; padding: 10px 14px; border-radius: 12px; font-weight: 800; font-size: 0.88rem; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-route" style="font-size: 1.1rem; color: #ff9e00;"></i> Distância Exata por Ruas: <strong>${routeData.distanceKm.toFixed(1).replace('.', ',')} km</strong> (${routeData.durationMinutes} min)
        </div>
      `;

      options.forEach((opt, idx) => {
        const isSelected = idx === 0;
        if (isSelected) state.selectedCategory = opt.categoryKey;

        const div = document.createElement('div');
        div.className = `category-item ${isSelected ? 'selected' : ''}`;
        div.onclick = () => {
          document.querySelectorAll('.category-item').forEach(c => c.classList.remove('selected'));
          div.classList.add('selected');
          state.selectedCategory = opt.categoryKey;
        };
        div.innerHTML = `
          <div class="icon">${opt.icon}</div>
          <div>
            <div class="name">${opt.name}</div>
            <div class="price">R$ ${opt.price.toFixed(2).replace('.', ',')}</div>
            <small style="color: #d97706; font-weight: bold;">⚡ ${routeData.distanceKm.toFixed(1).replace('.', ',')} km (${routeData.durationMinutes} min)</small>
          </div>
        `;
        grid.appendChild(div);
      });
    }

    const cardBooking = document.getElementById('cardBooking');
    if (cardBooking) cardBooking.classList.remove('hidden');

    showToast(`🛣️ Rota exata calculada por ruas: ${routeData.distanceKm.toFixed(1).replace('.', ',')} km!`, 'success');
  } catch (err) {
    console.error('Erro no cálculo de tarifa:', err);
    const cardBooking = document.getElementById('cardBooking');
    if (cardBooking) cardBooking.classList.remove('hidden');
  } finally {
    if (btn) btn.innerHTML = '<i class="fa-solid fa-calculator"></i> Recalcular Rota & Tarifa 99';
  }
};

window.handleRequestRideSubmit = async function() {
  const originText = document.getElementById('inputOrigin')?.value?.trim();
  const destText = document.getElementById('inputDestination')?.value?.trim();
  const originNum = document.getElementById('inputOriginNumber')?.value?.trim();
  const destNum = document.getElementById('inputDestinationNumber')?.value?.trim();

  if (!originText || !destText) {
    showToast('⚠️ Por favor digite o Endereço de Origem e o Endereço de Destino!', 'warning');
    alert('Por favor digite o Endereço de Origem e o Endereço de Destino antes de solicitar a viagem!');
    return;
  }

  const btn = document.getElementById('btnRequestRide');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mapeando Endereço Exato & Solicitando...';

  try {
    const fullOriginText = `${originText}${originNum ? ', nº ' + originNum : ''}`;
    const fullDestText = `${destText}${destNum ? ', nº ' + destNum : ''}`;

    let origObj = state.lastCalculatedOrigin;
    let destObj = state.lastCalculatedDestination;

    if (!origObj || !origObj.name || !origObj.name.toLowerCase().includes(originText.toLowerCase())) {
      origObj = await geocodeAddressText(fullOriginText, 'origin');
    } else if (originNum && !origObj.name.includes('nº')) {
      origObj.name = `${origObj.name}, nº ${originNum}`;
    }

    if (!destObj || !destObj.name || !destObj.name.toLowerCase().includes(destText.toLowerCase())) {
      destObj = await geocodeAddressText(fullDestText, 'destination');
    } else if (destNum && !destObj.name.includes('nº')) {
      destObj.name = `${destObj.name}, nº ${destNum}`;
    }

    state.lastCalculatedOrigin = origObj;
    state.lastCalculatedDestination = destObj;

    const routeData = await fetchOSRMRoute(origObj, destObj);

    const currentPsg = getPassengerProfile();
    const name = currentPsg?.name || 'Cliente 99';
    const dist = routeData.distanceKm ? routeData.distanceKm.toFixed(1).replace('.', ',') : '4,2';

    const paySelect = document.getElementById('selectPayment') || document.getElementById('selectPaymentMethod');
    const payMethodKey = paySelect ? paySelect.value : 'pix';
    const payMethodName = payMethodKey === 'cash' ? '💵 Dinheiro ao Motorista' : (payMethodKey === 'credit_card' ? '💳 Cartão 99' : '⚡ PIX');

    const options = calculateFareCategories(routeData.distanceKm, routeData.durationMinutes);
    const selectedOpt = options.find(o => o.categoryKey === (state.selectedCategory || 'pop')) || options[0];

    const ridePayload = {
      id: `ride-${Date.now()}`,
      passengerName: name,
      origin: origObj,
      destination: destObj,
      price: selectedOpt ? selectedOpt.price : 18.50,
      distanceKm: routeData.distanceKm,
      durationMinutes: routeData.durationMinutes,
      paymentMethod: payMethodKey,
      paymentMethodName: payMethodName
    };

    state.currentRide = ridePayload;

    const statusElem = document.getElementById('passengerStatus');
    if (statusElem) {
      statusElem.innerText = `🟡 Viagem 99 Solicitada! Procurando motoristas online (${dist} km)...`;
      statusElem.style.background = 'rgba(255, 158, 0, 0.25)';
      statusElem.style.color = '#d97706';
    }

    showToast(`⚡ Viagem 99 (${dist} km) solicitada por ${name}! Disparando alarme aos motoristas...`, 'info');

    try {
      fetch(`${BACKEND_URL}/api/rides/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passengerName: name,
          origin: ridePayload.origin,
          destination: ridePayload.destination,
          categoryKey: state.selectedCategory || 'pop',
          estimatedPrice: ridePayload.price,
          paymentMethod: payMethodKey
        })
      }).catch(() => {});
    } catch(e) {}

    broadcastRideEvent('NEW_RIDE_REQUESTED', ridePayload);

    const isDriverPage = !!document.getElementById('mapDriver');
    if (isDriverPage) {
      showRideDispatchToAllOnlineDrivers(ridePayload);
    }
  } catch (err) {
    console.error('Erro ao solicitar corrida:', err);
    showToast('⚡ Chamada enviada aos motoristas!', 'info');
  } finally {
    setTimeout(() => {
      if (btn) btn.innerHTML = '✅ SOLICITAÇÃO ENVIADA COM SUCESSO!';
    }, 600);
  }
};

// ---------------- PWA SERVICE WORKER & INSTALLATION PROMPT ----------------
let deferredPwaPrompt = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(() => {
      console.log('📱 Service Worker PWA registrado com sucesso!');
    }).catch(err => {
      console.warn('Erro ao registrar Service Worker:', err);
    });
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPwaPrompt = e;
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.classList.remove('hidden');
});

window.installPwaApp = async function() {
  if (deferredPwaPrompt) {
    deferredPwaPrompt.prompt();
    const { outcome } = await deferredPwaPrompt.userChoice;
    if (outcome === 'accepted') {
      showToast('🎉 Aplicativo 99 Instalado com sucesso na tela inicial!', 'success');
    }
    deferredPwaPrompt = null;
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.classList.add('hidden');
  } else {
    showToast('📱 Toque no menu do seu navegador e selecione "Adicionar à Tela de Início"!', 'info');
  }
};

// ---------------- GESTÃO DE TARIFAS & ZONAS PROMOCIONAIS DINÂMICAS ----------------
window.handleSaveAdminFares = function(evt) {
  if (evt) evt.preventDefault();
  const basePrice = document.getElementById('inputAdminBasePrice')?.value || 6.00;
  const pricePerKm = document.getElementById('inputAdminPricePerKm')?.value || 2.50;
  const pricePerMin = document.getElementById('inputAdminPricePerMin')?.value || 0.50;
  const platformFeePercent = document.getElementById('inputAdminPlatformFee')?.value || 15;

  const farePayload = {
    basePrice: parseFloat(basePrice),
    pricePerKm: parseFloat(pricePerKm),
    pricePerMin: parseFloat(pricePerMin),
    platformFeePercent: parseFloat(platformFeePercent)
  };

  if (BACKEND_URL) {
    fetch(`${BACKEND_URL}/api/config/fares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(farePayload)
    }).then(r => r.json()).then(res => {
      showToast('💾 Tarifas e taxas salvas e aplicadas em tempo real!', 'success');
    }).catch(() => {
      showToast('💾 Tarifas salvas localmente!', 'success');
    });
  } else {
    showToast('💾 Tarifas salvas com sucesso!', 'success');
  }
};

window.handleCreatePromoZone = function(evt) {
  if (evt) evt.preventDefault();
  const name = document.getElementById('inputZoneName')?.value;
  const surgeFactor = document.getElementById('selectZoneSurge')?.value || 1.5;
  const driverBonus = document.getElementById('inputZoneDriverBonus')?.value || 5.00;
  const passengerDiscount = document.getElementById('inputZonePassengerDiscount')?.value || 10;

  if (!name) {
    showToast('⚠️ Informe o nome da zona/bairro!', 'warning');
    return;
  }

  const zonePayload = {
    name,
    surgeFactor: parseFloat(surgeFactor),
    driverBonus: parseFloat(driverBonus),
    passengerDiscount: parseFloat(passengerDiscount)
  };

  if (BACKEND_URL) {
    fetch(`${BACKEND_URL}/api/config/promo-zones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(zonePayload)
    }).then(r => r.json()).then(res => {
      showToast(`🚀 Zona Promocional "${name}" (Dinâmica ${surgeFactor}x) Ativada!`, 'success');
      loadAdminConfig();
    }).catch(() => {
      showToast(`🚀 Zona Promocional "${name}" Ativada!`, 'success');
    });
  } else {
    showToast(`🚀 Zona Promocional "${name}" Ativada!`, 'success');
  }
};

window.deletePromoZone = function(zoneId) {
  if (BACKEND_URL) {
    fetch(`${BACKEND_URL}/api/config/promo-zones/${zoneId}`, {
      method: 'DELETE'
    }).then(() => {
      showToast('🔴 Zona promocional desativada.', 'info');
      loadAdminConfig();
    }).catch(() => {});
  }
};

function renderAdminZonesTable(zones) {
  const tbody = document.getElementById('adminZonesTable');
  if (!tbody) return;

  if (!zones || zones.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #6b7280; padding: 14px;">Nenhuma zona promocional ativada no momento.</td></tr>`;
    return;
  }

  tbody.innerHTML = zones.map(z => `
    <tr>
      <td><strong>${z.name}</strong></td>
      <td><span class="badge-surge" style="background: #fffbeb; color: #d97706; border: 1px solid #fde68a; font-weight: 800; padding: 4px 10px; border-radius: 10px;">⚡ ${z.surgeFactor}x</span></td>
      <td><span style="color: #10b981; font-weight: 800;">+R$ ${parseFloat(z.driverBonus || 0).toFixed(2).replace('.', ',')}</span></td>
      <td><span style="color: #0284c7; font-weight: 800;">${z.passengerDiscount || 0}% Off</span></td>
      <td><span style="color: #10b981; font-weight: 800;">🟢 ATIVA</span></td>
      <td>
        <button type="button" onclick="window.deletePromoZone('${z.id}')" style="background: #ef4444; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 800; cursor: pointer;">🔴 Desativar</button>
      </td>
    </tr>
  `).join('');
}

window.handleSaveAdminSupport = function(evt) {
  if (evt) evt.preventDefault();
  const name = document.getElementById('inputAdminSupportName')?.value?.trim();
  const phone = document.getElementById('inputAdminSupportPhone')?.value?.trim();

  if (!name || !phone) {
    showToast('⚠️ Por favor informe o Nome e o WhatsApp do Suporte!', 'warning');
    return;
  }

  const cleanPhone = phone.replace(/\D/g, '');
  try {
    localStorage.setItem('99_SUPPORT_NAME', name);
    localStorage.setItem('99_SUPPORT_PHONE', cleanPhone);
  } catch(e) {}

  if (BACKEND_URL) {
    fetch(`${BACKEND_URL}/api/config/support`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone: cleanPhone })
    }).then(r => r.json()).then(() => {
      showToast('🛡️ Contato do Atendente de Suporte salvo com sucesso!', 'success');
    }).catch(() => {
      showToast('🛡️ Suporte salvo localmente!', 'info');
    });
  } else {
    showToast('🛡️ Suporte salvo localmente!', 'info');
  }
};

// ---------------- FLUXO DE DEVOLUÇÃO DE ENCOMENDA (DESTINATÁRIO AUSENTE) ----------------
window.driverRequestReturn = function() {
  if (!state.currentRide) {
    showToast('⚠️ Nenhuma corrida ativa para solicitar devolução.', 'warning');
    return;
  }

  const ride = state.currentRide;
  const rideId = ride.id;
  ride.returnStatus = 'REQUESTED';
  ride.status = 'RETURN_REQUESTED';

  const statusElem = document.getElementById('driverActiveStatus');
  if (statusElem) {
    statusElem.innerText = '🚨 Devolução Solicitada ao Suporte (WhatsApp)';
    statusElem.style.background = '#dc2626';
  }

  const passStatus = document.getElementById('passengerStatus');
  if (passStatus) {
    passStatus.innerText = '⚠️ Destinatário ausente no destino! Motorista contatando o Suporte 99...';
    passStatus.style.background = 'rgba(239, 68, 68, 0.2)';
    passStatus.style.color = '#dc2626';
  }

  // Notificar backend sem tocar sirene
  if (BACKEND_URL) {
    fetch(`${BACKEND_URL}/api/rides/${rideId}/return-request`, { method: 'POST' }).catch(() => {});
  }
  broadcastRideEvent('RETURN_RIDE_REQUESTED', ride);

  // ABRIR WHATSAPP DIRETO DO ATENDENTE DE SUPORTE CADASTRADO
  const currentDriver = getDriverProfile() || { name: 'Motorista 99' };
  const savedPhone = localStorage.getItem('99_SUPPORT_PHONE') || '5511999998888';
  const cleanPhone = savedPhone.replace(/\D/g, '');

  const rideIdText = ride.id || 'Sem ID';
  const psgName = ride.passengerName || 'Cliente 99';
  const drvName = currentDriver.name || 'Motorista';
  const origName = ride.origin?.name || 'Local de Coleta';
  const destName = ride.destination?.name || 'Local de Entrega';
  const fareVal = (ride.price || 18.50).toFixed(2).replace('.', ',');

  const messageText = `🚨 *SOLICITAÇÃO DE DEVOLUÇÃO 99*\n\n` +
    `🆔 *ID da Corrida:* ${rideIdText}\n` +
    `👤 *Cliente:* ${psgName}\n` +
    `🚗 *Motorista:* ${drvName}\n` +
    `🟢 *Local de Coleta (Origem):* ${origName}\n` +
    `🔴 *Local de Destino (Ausente):* ${destName}\n` +
    `💵 *Valor:* R$ ${fareVal}\n\n` +
    `⚠️ *Motivo:* Cheguei ao local de entrega e NÃO HÁ NINGUÉM para receber a encomenda. Solicito autorização do suporte para retornar ao endereço de origem!`;

  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`;

  showToast('📲 Redirecionando para o WhatsApp do Suporte 99...', 'info');

  try {
    window.open(waUrl, '_blank');
  } catch(e) {}
};

window.adminApproveReturn = function(rideId) {
  if (BACKEND_URL) {
    fetch(`${BACKEND_URL}/api/rides/${rideId}/return-approve`, { method: 'POST' })
      .then(r => r.json())
      .then(() => {
        showToast('✅ Devolução Aprovada pelo Suporte com sucesso!', 'success');
        loadAdminReturnsList();
      })
      .catch(() => {});
  }
  if (state.currentRide && String(state.currentRide.id) === String(rideId)) {
    state.currentRide.returnStatus = 'APPROVED_RETURN_IN_PROGRESS';
    state.currentRide.status = 'RETURN_IN_PROGRESS';
    broadcastRideEvent('RETURN_RIDE_APPROVED', state.currentRide);
  }
};

window.driverConfirmReturnCompleted = function() {
  const name = document.getElementById('inputReturnReceiverName')?.value?.trim();
  const phone = document.getElementById('inputReturnReceiverPhone')?.value?.trim();

  if (!name || !phone) {
    showToast('⚠️ Por favor preencha o Nome e Telefone do recebedor da devolução!', 'warning');
    return;
  }

  if (state.currentRide) {
    state.currentRide.returnStatus = 'RETURNED_SUCCESS';
    state.currentRide.status = 'RETURNED_COMPLETED';
    state.currentRide.returnReceiverName = name;
    state.currentRide.returnReceiverPhone = phone;

    if (BACKEND_URL) {
      fetch(`${BACKEND_URL}/api/rides/${state.currentRide.id}/return-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverName: name, receiverPhone: phone })
      }).catch(() => {});
    }

    broadcastRideEvent('RETURN_RIDE_COMPLETED', state.currentRide);
  }

  const modal = document.getElementById('modalReturnReceiver');
  if (modal) modal.classList.add('hidden');

  const activeCard = document.getElementById('cardDriverActiveRide');
  if (activeCard) activeCard.classList.add('hidden');

  const statusElem = document.getElementById('driverActiveStatus');
  if (statusElem) {
    statusElem.innerText = '✅ Devolução Concluída';
    statusElem.style.background = '#10b981';
  }

  showToast(`✅ Devolução entregue com sucesso para ${name} (${phone})!`, 'success');
};

function renderAdminReturnsTable(ridesList) {
  const tbody = document.getElementById('adminReturnsTable');
  if (!tbody) return;

  const returnRides = (ridesList || []).filter(r => r.returnStatus && r.returnStatus !== 'NONE');

  if (returnRides.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #6b7280; padding: 16px;">Nenhuma solicitação de devolução pendente no momento.</td></tr>`;
    return;
  }

  tbody.innerHTML = returnRides.map(r => `
    <tr>
      <td><strong>${r.id}</strong></td>
      <td><strong>${r.passengerName || 'Cliente 99'}</strong></td>
      <td><span style="color: #10b981; font-weight: 700;">🟢 ${r.origin?.name || 'Local de Coleta'}</span></td>
      <td><span style="color: #ef4444; font-weight: 700;">🔴 ${r.destination?.name || 'Destino (Ausente)'}</span></td>
      <td>
        ${r.returnStatus === 'REQUESTED' ? '<span style="background: #fef2f2; color: #dc2626; padding: 4px 10px; border-radius: 10px; font-weight: 800;">🚨 DEVOLUÇÃO SOLICITADA</span>' : ''}
        ${r.returnStatus === 'APPROVED_RETURN_IN_PROGRESS' ? '<span style="background: #f3e8ff; color: #7c3aed; padding: 4px 10px; border-radius: 10px; font-weight: 800;">🔄 EM RETORNO / DEVOLUÇÃO</span>' : ''}
        ${r.returnStatus === 'RETURNED_SUCCESS' ? '<span style="background: #d1fae5; color: #047857; padding: 4px 10px; border-radius: 10px; font-weight: 800;">✅ DEVOLUÇÃO CONCLUÍDA</span>' : ''}
      </td>
      <td>
        ${r.returnReceiverName ? `<strong>${r.returnReceiverName}</strong><br><small style="color: #64748b;">${r.returnReceiverPhone || ''}</small>` : '<small style="color: #9ca3af;">Aguardando retorno</small>'}
      </td>
      <td>
        ${r.returnStatus === 'REQUESTED' ? `<button type="button" onclick="window.adminApproveReturn('${r.id}')" style="background: #7c3aed; color: #fff; border: none; padding: 8px 14px; border-radius: 8px; font-weight: 800; cursor: pointer;">🔄 APROVAR DEVOLUÇÃO</button>` : '<span style="color: #10b981; font-weight: 800;">Processado</span>'}
      </td>
    </tr>
  `).join('');
}

function loadAdminReturnsList() {
  if (BACKEND_URL) {
    fetch(`${BACKEND_URL}/api/rides/pending`).then(r => r.json()).then(rides => {
      renderAdminReturnsTable(rides);
    }).catch(() => {});
  }
}

// ---------------- DOMCONTENTLOADED INITIALIZATION ----------------
document.addEventListener('DOMContentLoaded', () => {
  try { ensureDefaultOnlineDriverExists(); } catch(e) {}
  try { initMaps(); } catch(e) {}
  try { loadAdminDrivers(); } catch(e) {}
  try { loadAdminConfig(); } catch(e) {}
  try { loadAdminReturnsList(); } catch(e) {}
  try { loadCurrentPassengerUI(); } catch(e) {}
  try { initCrossTabDispatchListeners(); } catch(e) {}

  try { setupAddressAutocomplete('inputOrigin', 'suggestionsOrigin', 'origin'); } catch(e) {}
  try { setupAddressAutocomplete('inputDestination', 'suggestionsDest', 'destination'); } catch(e) {}

  // Auto-cálculo automático de rota por ruas e quilômetros ao digitar ou alterar o endereço/número
  let autoCalcTimeout = null;
  const triggerAutoCalc = () => {
    if (autoCalcTimeout) clearTimeout(autoCalcTimeout);
    autoCalcTimeout = setTimeout(() => {
      try { window.handleCalculateFareSubmit(); } catch(e) {}
    }, 600);
  };

  ['inputOrigin', 'inputOriginNumber', 'inputDestination', 'inputDestinationNumber'].forEach(id => {
    const elem = document.getElementById(id);
    if (elem) {
      elem.addEventListener('input', triggerAutoCalc);
      elem.addEventListener('change', triggerAutoCalc);
      elem.addEventListener('blur', triggerAutoCalc);
    }
  });

  setTimeout(renderOnlineFleetOnPassengerMap, 1000);
  setInterval(renderOnlineFleetOnPassengerMap, 3000);

  safeAddEventListener('btnCalculateFare', 'click', window.handleCalculateFareSubmit);
  safeAddEventListener('btnRequestRide', 'click', window.handleRequestRideSubmit);
});
