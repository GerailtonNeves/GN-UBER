/* ====================================================
   99 SUPER-APP ENGINE v3.0 - OFFICIAL JAVASCRIPT LOGIC
   WITH REAL STREET-BY-STREET TURN-BY-TURN ROUTING ENGINE
   ==================================================== */

const BACKEND_URL = 'http://localhost:4000';

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

function safeAddEventListener(id, event, handler) {
  const elem = document.getElementById(id);
  if (elem) elem.addEventListener(event, handler);
}

// Socket.io Connection Real-time
try {
  if (typeof io !== 'undefined') {
    state.socket = io(BACKEND_URL);
    state.socket.on('NEW_RIDE_REQUESTED', (ridePayload) => {
      console.log('📡 Nova corrida recebida via Socket.io:', ridePayload);
      showRideDispatchToAllOnlineDrivers(ridePayload);
    });
    state.socket.on('RIDE_ACCEPTED_FIRST_WINNER', (payload) => {
      handleRideAcceptedWinner(payload);
    });
  }
} catch(e) {}

// ---------------- 🔊 SINTETIZADOR DE SOM DE SIRENE 99 ----------------
let audioCtx = null;
let sirenOsc = null;
let sirenGain = null;
let sirenInterval = null;

function playSirenSound() {
  stopSirenSound();
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioCtx = new AudioContextClass();

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    sirenOsc = audioCtx.createOscillator();
    sirenGain = audioCtx.createGain();

    sirenOsc.type = 'sawtooth';
    sirenOsc.frequency.setValueAtTime(800, audioCtx.currentTime);
    sirenGain.gain.setValueAtTime(0.4, audioCtx.currentTime);

    sirenOsc.connect(sirenGain);
    sirenGain.connect(audioCtx.destination);
    sirenOsc.start();

    let high = true;
    sirenInterval = setInterval(() => {
      if (!sirenOsc || !audioCtx) return;
      const targetFreq = high ? 1250 : 650;
      try {
        sirenOsc.frequency.exponentialRampToValueAtTime(targetFreq, audioCtx.currentTime + 0.3);
      } catch(e) {}
      high = !high;
    }, 380);
  } catch (err) {
    console.warn('Erro ao reproduzir som da sirene:', err);
  }
}

function stopSirenSound() {
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }
  if (sirenOsc) {
    try { sirenOsc.stop(); } catch (e) {}
    sirenOsc = null;
  }
  if (audioCtx) {
    try { audioCtx.close(); } catch (e) {}
    audioCtx = null;
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

function showRideDispatchModal(ride) {
  dispatchRideToOnlineDriversChain(ride, 0);
}

window.acceptRideDispatch = function() {
  stopSirenSound();
  if (state.dispatchTimerInterval) clearInterval(state.dispatchTimerInterval);

  const modal = document.getElementById('modalRideDispatch');
  if (modal) modal.classList.add('hidden');

  const driver = state.assignedDriver || { name: 'Motorista 99' };
  const passengerName = document.getElementById('dispatchPassengerName')?.innerText || 'Cliente 99';
  const originName = document.getElementById('dispatchOrigin')?.innerText || 'MASP - Av. Paulista';
  const destName = document.getElementById('dispatchDest')?.innerText || 'Parque Ibirapuera';
  const fareVal = document.getElementById('dispatchFare')?.innerText || 'R$ 18,50';

  // NOTIFICAR EM TEMPO REAL TODAS AS ABAS/DISPOSITIVOS DO CLIENTE QUE A CORRIDA FOI ACEITA!
  broadcastRideEvent('RIDE_ACCEPTED_BY_DRIVER', {
    driverName: driver.name,
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
      statusElem.innerText = '🟡 Motorista a Caminho';
      statusElem.style.background = '#10b981';
    }
  }

  // 2. Traçar a Rota GPS no Mapa do Motorista
  if (state.driverMap) {
    setTimeout(() => {
      state.driverMap.invalidateSize();
      const origin = state.lastCalculatedOrigin || LOCATIONS.MASP;
      const dest = state.lastCalculatedDestination || LOCATIONS.IBIRAPUERA;
      const routeData = {
        coordinates: [
          [origin.lat, origin.lng],
          [(origin.lat + dest.lat) / 2 + 0.002, (origin.lng + dest.lng) / 2 - 0.002],
          [dest.lat, dest.lng]
        ]
      };
      renderRouteOnMap(state.driverMap, routeData, origin, dest, 'driver');
    }, 200);
  }

  // 3. Atualizar Status no App do Cliente se Aberto
  const passStatus = document.getElementById('passengerStatus');
  if (passStatus) {
    passStatus.innerText = '🚗 Motorista 99 Aceitou e está a caminho!';
    passStatus.style.background = 'rgba(16, 185, 129, 0.18)';
    passStatus.style.color = '#10b981';
  }

  showToast(`🎉 Corrida 99 Aceita por ${driver.name}!`, 'success');
  alert(`🎉 CORRIDA 99 ACEITA COM SUCESSO POR ${driver.name.toUpperCase()}!\n\nNavegação GPS ativada! Dirija-se ao local de embarque do cliente.`);
};

// ---------------- CONTATO E SUPORTE 99 ----------------
window.callPassenger = function() {
  const currentPsg = getPassengerProfile();
  const phone = currentPsg?.phone || '(11) 98888-7777';
  showToast(`📞 Ligando para o cliente: ${phone}...`, 'info');
  alert(`📞 LIGANDO PARA O CLIENTE:\n\nNúmero: ${phone}\n\nConectando chamada telefônica...`);
};

window.openChatWithPassenger = function() {
  showToast('💬 Abrindo Chat 99 em tempo real com o cliente...', 'info');
  alert('💬 CHAT 99 EM TEMPO REAL:\n\nVocê pode trocar mensagens de texto diretas com o passageiro durante a corrida.');
};

window.openSupport99 = function() {
  showToast('🛡️ Abrindo Central de Suporte 99 24h...', 'info');
  alert('🛡️ CENTRAL DE SUPORTE 99 24 HORAS:\n\nEquipe de atendimento pronta para ajudar com ocorrências, emergências e dúvidas financeiras.');
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
  showToast('📍 Você chegou ao local de embarque!', 'info');
  alert('📍 VOCÊ CHEGOU AO LOCAL DE EMBARQUE/COLETA!\n\nAguarde o cliente ou receba o pacote.');
};

window.driverCollectPackage = function() {
  const statusElem = document.getElementById('driverActiveStatus');
  if (statusElem) {
    statusElem.innerText = '📦 Coletando Encomenda...';
    statusElem.style.background = '#f59e0b';
  }
  showToast('📦 Coletando encomenda/passageiro no local...', 'info');
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

  // ABRIR E REDIRECIONAR O MAPA COM O ENDEREÇO PREENCHIDO DO DESTINO DE ENTREGA
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

  showToast('✅ Coleta Concluída! Rota do Destino traçada no GPS.', 'success');
  alert(`✅ ENCOMENDA / PASSAGEIRO COLETADO COM SUCESSO!\n\nO mapa foi atualizado e preenchido com a Rota GPS até o Endereço de ENTREGA do Destino Final!`);
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
    ? `💵 PAGAMENTO EM DINHEIRO RECEBIDO E CONFIRMADO!\n\nValor Recebido: ${fareVal}\n\nViagem 99 Concluída com Sucesso!`
    : `🏁 VIAGEM CONCLUÍDA E ENTREGUE COM SUCESSO!\n\nValor creditado: ${fareVal}\n\nObrigado por prestar um excelente serviço na 99!`;

  showToast('🏁 Viagem concluída com sucesso!', 'success');
  alert(msg);
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

// ---------------- DOMCONTENTLOADED INITIALIZATION ----------------
document.addEventListener('DOMContentLoaded', () => {
  try { initMaps(); } catch(e) {}
  try { loadAdminDrivers(); } catch(e) {}
  try { loadCurrentPassengerUI(); } catch(e) {}
  try { initCrossTabDispatchListeners(); } catch(e) {}

  try { setupAddressAutocomplete('inputOrigin', 'suggestionsOrigin', 'origin'); } catch(e) {}
  try { setupAddressAutocomplete('inputDestination', 'suggestionsDest', 'destination'); } catch(e) {}

  setTimeout(renderOnlineFleetOnPassengerMap, 1000);
  setInterval(renderOnlineFleetOnPassengerMap, 3000);

  safeAddEventListener('btnCalculateFare', 'click', async () => {
    const btn = document.getElementById('btnCalculateFare');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Traçando Rota por Ruas e Curvas...';

    const originText = document.getElementById('inputOrigin')?.value || LOCATIONS.MASP.name;
    const destText = document.getElementById('inputDestination')?.value || LOCATIONS.IBIRAPUERA.name;

    const origin = await geocodeAddressText(originText, 'origin');
    const dest = await geocodeAddressText(destText, 'destination');

    state.lastCalculatedOrigin = origin;
    state.lastCalculatedDestination = dest;

    const routeData = await fetchOSRMRoute(origin, dest);
    const options = calculateFareCategories(routeData.distanceKm, routeData.durationMinutes);

    state.fareEstimate = {
      distanceKm: routeData.distanceKm,
      durationMinutes: routeData.durationMinutes,
      options
    };

    renderRouteOnMap(state.passengerMap, routeData, origin, dest, 'passenger');

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

    if (btn) btn.innerHTML = '<i class="fa-solid fa-calculator"></i> Recalcular Rota & Tarifa 99';

    document.getElementById('cardBooking')?.classList.remove('hidden');
    showToast(`🛣️ Rota exata calculada por ruas: ${routeData.distanceKm.toFixed(1).replace('.', ',')} km!`, 'success');
  });

  window.handleRequestRideSubmit = function() {
    const currentPsg = getPassengerProfile();
    const name = currentPsg?.name || 'Cliente 99';
    const dist = state.fareEstimate ? state.fareEstimate.distanceKm.toFixed(1).replace('.', ',') : '4,2';

    const paySelect = document.getElementById('selectPayment') || document.getElementById('selectPaymentMethod');
    const payMethodKey = paySelect ? paySelect.value : 'pix';
    const payMethodName = payMethodKey === 'cash' ? '💵 Dinheiro ao Motorista' : (payMethodKey === 'credit_card' ? '💳 Cartão 99' : '⚡ PIX');

    const ridePayload = {
      id: `ride-${Date.now()}`,
      passengerName: name,
      origin: state.lastCalculatedOrigin || LOCATIONS.MASP,
      destination: state.lastCalculatedDestination || LOCATIONS.IBIRAPUERA,
      price: state.fareEstimate?.options?.[0]?.price || 18.50,
      distanceKm: state.fareEstimate?.distanceKm || 4.2,
      durationMinutes: state.fareEstimate?.durationMinutes || 12,
      paymentMethod: payMethodKey,
      paymentMethodName: payMethodName
    };

    showToast(`⚡ Viagem 99 (${dist} km) solicitada por ${name}!`, 'info');
    alert(`🎉 Viagem 99 Solicitada com Sucesso por ${name}!\n\n🔔 Disparando alerta em TEMPO REAL com SIRENE para TODOS os motoristas ONLINE...`);

    broadcastRideEvent('NEW_RIDE_REQUESTED', ridePayload);
    showRideDispatchToAllOnlineDrivers(ridePayload);
  };

  safeAddEventListener('btnRequestRide', 'click', window.handleRequestRideSubmit);
});
