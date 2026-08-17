// ====================================================
// UBERFLOW CLIENT ENGINE v2.0 - REAL-TIME APPLICATION LOGIC
// ====================================================

const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:4000'
  : (window.ENV_BACKEND_URL || 'https://uberflow-backend.onrender.com');

// Coordenadas de Referência em SP (Latitude, Longitude)
const LOCATIONS = {
  MASP: { name: 'MASP - Av. Paulista, 1578', lat: -23.561684, lng: -46.655981 },
  CONGONHAS: { name: 'Aeroporto de Congonhas', lat: -23.626111, lng: -46.656389 },
  IBIRAPUERA: { name: 'Parque Ibirapuera - Portão 3', lat: -23.587416, lng: -46.657634 },
  SE: { name: 'Praça da Sé - Centro', lat: -23.550520, lng: -46.633309 }
};

let state = {
  socket: null,
  activeMode: 'split',
  currentDriverId: 'drv-1',
  currentRide: null,
  pendingDispatchRide: null,
  dispatchTimerInterval: null,
  selectedCategory: 'uberx',
  fareEstimate: null,
  passengerMap: null,
  driverMap: null,
  passengerMarkers: {},
  driverMarkers: {},
  routePolylinePassenger: null,
  routePolylineDriver: null,
  simulationInterval: null,
  customOrigin: null,
  customDestination: null
};

// Toast Notifications System
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span> <div>${message}</div>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Sistema de Sirene de Alerta (5 segundos máximo ou até o aceite)
let sirenAudioCtx = null;
let sirenOscillator = null;
let sirenTimeoutTimer = null;
let sirenInterval = null;

function startSirenSound() {
  stopSirenSound(); // Parar sirene anterior se houver

  try {
    sirenAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sirenOscillator = sirenAudioCtx.createOscillator();
    const gainNode = sirenAudioCtx.createGain();

    sirenOscillator.type = 'sawtooth';
    gainNode.gain.setValueAtTime(0.25, sirenAudioCtx.currentTime);

    sirenOscillator.connect(gainNode);
    gainNode.connect(sirenAudioCtx.destination);
    sirenOscillator.start();

    // Alternar tom de sirene (WEE-WOO) entre 650Hz e 950Hz
    let high = false;
    sirenInterval = setInterval(() => {
      if (sirenOscillator && sirenAudioCtx) {
        const freq = high ? 650 : 950;
        sirenOscillator.frequency.setValueAtTime(freq, sirenAudioCtx.currentTime);
        high = !high;
      }
    }, 250);

    // Timer de 5 segundos MAX: desliga a sirene se ninguém aceitar em 5s
    sirenTimeoutTimer = setTimeout(() => {
      stopSirenSound();
    }, 5000);
  } catch (e) {
    console.log('Siren sound blocked or error:', e);
  }
}

function stopSirenSound() {
  if (sirenTimeoutTimer) {
    clearTimeout(sirenTimeoutTimer);
    sirenTimeoutTimer = null;
  }
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }
  if (sirenOscillator) {
    try {
      sirenOscillator.stop();
      sirenOscillator.disconnect();
    } catch (e) {}
    sirenOscillator = null;
  }
  if (sirenAudioCtx) {
    try {
      sirenAudioCtx.close();
    } catch (e) {}
    sirenAudioCtx = null;
  }
}

state.onlineFleetMarkers = {}; // Armazena marcadores de veículos online no mapa do passageiro

async function renderOnlineFleetOnPassengerMap() {
  if (!state.passengerMap) return;

  try {
    const res = await fetch(`${BACKEND_URL}/api/drivers`);
    const drivers = await res.json();

    // Filtra EXCLUSIVAMENTE os motoristas ONLINE e VERIFICADOS
    const onlineDrivers = drivers.filter(d => d.status === 'online' && d.verified);

    // Remover do mapa motoristas que mudaram para OFFLINE
    Object.keys(state.onlineFleetMarkers).forEach(driverId => {
      const exists = onlineDrivers.find(d => d.id === driverId);
      if (!exists) {
        state.onlineFleetMarkers[driverId].remove();
        delete state.onlineFleetMarkers[driverId];
      }
    });

    // Adicionar/Atualizar no mapa todos os motoristas ONLINE
    onlineDrivers.forEach(d => {
      const latLng = [d.location.lat, d.location.lng];
      const vehicleType = d.vehicle ? d.vehicle.type : 'uberx';
      const icon = createVehicleIcon(vehicleType, d.location.heading || 0);

      if (!state.onlineFleetMarkers[d.id]) {
        const marker = L.marker(latLng, { icon })
          .addTo(state.passengerMap)
          .bindPopup(`
            <div style="font-size: 0.85rem; font-family: sans-serif; text-align: center;">
              <strong>${vehicleType === 'moto' ? '🏍️ Moto' : '🚗 Carro'} • ${d.name}</strong><br>
              <span style="color: #38bdf8;">${d.vehicle.model} (${d.vehicle.color})</span><br>
              <small style="color: #10b981; font-weight: bold;">🟢 Motorista ONLINE (${d.rating} ⭐)</small>
            </div>
          `);
        state.onlineFleetMarkers[d.id] = marker;
      } else {
        state.onlineFleetMarkers[d.id].setLatLng(latLng);
        state.onlineFleetMarkers[d.id].setIcon(icon);
      }
    });
  } catch (err) {
    console.log('Erro ao atualizar frota online:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initMaps();
  initWebSocket();
  initEventHandlers();
  loadAdminDrivers();
  loadAdminMetrics();

  // Inicializar Autocomplete Inteligente (Rua + Cidade)
  setupAddressAutocomplete('inputOrigin', 'suggestionsOrigin', 'origin');
  setupAddressAutocomplete('inputDestination', 'suggestionsDest', 'destination');

  // Atualizar Frota Online no Mapa do Passageiro a cada 2.5 segundos
  setTimeout(renderOnlineFleetOnPassengerMap, 1000);
  setInterval(renderOnlineFleetOnPassengerMap, 2500);
});

function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const mainLayout = document.getElementById('mainLayout');
  const pPassenger = document.getElementById('panelPassenger');
  const pDriver = document.getElementById('panelDriver');
  const pAdmin = document.getElementById('panelAdmin');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.mode;
      state.activeMode = mode;

      if (mode === 'split') {
        mainLayout.classList.remove('mode-single');
        pPassenger.classList.remove('hidden');
        pDriver.classList.remove('hidden');
        pAdmin.classList.add('hidden');
      } else if (mode === 'passenger') {
        mainLayout.classList.add('mode-single');
        pPassenger.classList.remove('hidden');
        pDriver.classList.add('hidden');
        pAdmin.classList.add('hidden');
      } else if (mode === 'driver') {
        mainLayout.classList.add('mode-single');
        pPassenger.classList.add('hidden');
        pDriver.classList.remove('hidden');
        pAdmin.classList.add('hidden');
      } else if (mode === 'admin') {
        mainLayout.classList.add('mode-single');
        pPassenger.classList.add('hidden');
        pDriver.classList.add('hidden');
        pAdmin.classList.remove('hidden');
      }

      setTimeout(() => {
        if (state.passengerMap) state.passengerMap.invalidateSize();
        if (state.driverMap) state.driverMap.invalidateSize();
      }, 200);
    });
  });
}

function initMaps() {
  const defaultCenter = [LOCATIONS.MASP.lat, LOCATIONS.MASP.lng];

  state.passengerMap = L.map('mapPassenger').setView(defaultCenter, 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(state.passengerMap);

  state.driverMap = L.map('mapDriver').setView(defaultCenter, 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(state.driverMap);

  let clickTurn = 'origin';
  state.passengerMap.on('click', (e) => {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    if (clickTurn === 'origin') {
      state.customOrigin = { name: `Ponto no Mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`, lat, lng };
      document.getElementById('inputOrigin').value = `📍 Ponto no Mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      showToast('Origem marcada no mapa com sucesso!', 'info');
      clickTurn = 'destination';
    } else {
      state.customDestination = { name: `Ponto no Mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`, lat, lng };
      document.getElementById('inputDestination').value = `🏁 Ponto no Mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      showToast('Destino marcado no mapa com sucesso!', 'info');
      clickTurn = 'origin';
    }
  });
}

// Atalho para selecionar destinos rápidos
window.setPresetDestination = function(key) {
  const loc = LOCATIONS[key];
  if (loc) {
    state.customDestination = loc;
    document.getElementById('inputDestination').value = loc.name;
    showToast(`Destino selecionado: ${loc.name}`, 'info');
  }
};

async function geocodeAddressText(query, type = 'origin') {
  if (!query || query.trim() === '') return null;

  // 1. Se o usuário escolheu via Autocomplete ou Ponto Clicado no Mapa
  if (type === 'origin' && state.customOrigin) return state.customOrigin;
  if (type === 'destination' && state.customDestination) return state.customDestination;

  // 2. Se for um dos atalhos famosos
  const qUpper = query.toUpperCase();
  if (qUpper.includes('MASP')) return LOCATIONS.MASP;
  if (qUpper.includes('CONGONHAS')) return LOCATIONS.CONGONHAS;
  if (qUpper.includes('IBIRAPUERA')) return LOCATIONS.IBIRAPUERA;
  if (qUpper.includes('SÉ') || qUpper.includes('SE')) return LOCATIONS.SE;

  // 3. Buscar no Nominatim OpenStreetMap em tempo real
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        name: query,
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    }
  } catch (err) {
    console.log('Erro no geocoding:', err);
  }

  // 4. Garantia Infalível: Gerar coordenadas reais nas imediações de São Paulo
  return {
    name: query,
    lat: LOCATIONS.MASP.lat + (type === 'origin' ? 0 : 0.025),
    lng: LOCATIONS.MASP.lng + (type === 'origin' ? 0 : 0.025)
  };
}

// Autocomplete Inteligente em Tempo Real (Rua + Cidade + Animação de Mapa flyTo)
function setupAddressAutocomplete(inputId, dropdownId, fieldType) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;

  let debounceTimer = null;

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(debounceTimer);

    if (query.length < 2) {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=br&limit=6&q=${encodeURIComponent(query)}`);
        const results = await response.json();

        dropdown.innerHTML = '';
        if (results && results.length > 0) {
          dropdown.classList.remove('hidden');

          results.forEach(item => {
            const addr = item.address || {};
            const street = addr.road || addr.pedestrian || addr.suburb || item.display_name.split(',')[0];
            const city = addr.city || addr.town || addr.municipality || addr.village || 'São Paulo';
            const stateName = addr.state || 'SP';
            const fullLocationName = `${street} - ${city}/${stateName}`;

            const div = document.createElement('div');
            div.className = 'autocomplete-item';
            div.innerHTML = `
              <div class="item-icon">${fieldType === 'origin' ? '🟢' : '🔴'}</div>
              <div class="item-info">
                <div class="street-name">${street}</div>
                <div class="city-name">${city} - ${stateName}</div>
              </div>
            `;

            div.onclick = () => {
              input.value = fullLocationName;
              dropdown.classList.add('hidden');

              const coords = { name: fullLocationName, lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
              if (fieldType === 'origin') {
                state.customOrigin = coords;
                if (state.originMarker) state.originMarker.remove();
              } else {
                state.customDestination = coords;
                if (state.destinationMarker) state.destinationMarker.remove();
              }

              // Mover suavemente o mapa até o local exato com o pino
              if (state.passengerMap) {
                state.passengerMap.flyTo([coords.lat, coords.lng], 16, { animate: true, duration: 1.2 });
                const marker = L.marker([coords.lat, coords.lng], { icon: createPinIcon(fieldType) })
                  .addTo(state.passengerMap)
                  .bindPopup(`<b>${fieldType === 'origin' ? '🟢 Ponto de Embarque' : '🔴 Ponto de Desembarque'}</b><br>${fullLocationName}`)
                  .openPopup();

                if (fieldType === 'origin') state.originMarker = marker;
                else state.destinationMarker = marker;
              }

              showToast(`🎯 Mapa movido para: ${fullLocationName}`, 'info');
            };

            dropdown.appendChild(div);
          });
        } else {
          dropdown.classList.add('hidden');
        }
      } catch (err) {
        console.log('Erro ao buscar sugestões:', err);
      }
    }, 200);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });
}

function createVehicleIcon(categoryKey = 'uberx', heading = 0, color = '#3b82f6') {
  let iconSymbol = '🚗';
  if (categoryKey === 'moto') {
    iconSymbol = '🏍️';
  } else if (categoryKey === 'delivery') {
    iconSymbol = '📦';
  } else if (categoryKey === 'comfort') {
    iconSymbol = '🚘';
  }

  return L.divIcon({
    className: 'custom-vehicle-icon',
    html: `<div style="transform: rotate(${heading}deg); font-size: 28px; text-shadow: 0 2px 6px rgba(0,0,0,0.6); filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.5));">${iconSymbol}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

function createPinIcon(type = 'origin') {
  const icon = type === 'origin' ? '🟢' : '🔴';
  return L.divIcon({
    className: 'custom-pin-icon',
    html: `<div style="font-size: 24px;">${icon}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30]
  });
}

function initWebSocket() {
  state.socket = io(BACKEND_URL);

  state.socket.on('connect', () => {
    console.log('✅ Conectado ao servidor Engine Socket.io:', state.socket.id);
  });

  state.socket.on('new_ride_available', (ride) => {
    const driverToggle = document.getElementById('toggleDriverOnline');

    if (driverToggle.checked && (!state.currentRide || state.currentRide.status === 'COMPLETED')) {
      showRideDispatchModal(ride);
    } else {
      showToast('🚨 Nova solicitação de corrida recebida! Ligue o botão ONLINE no painel do motorista.', 'warning');
    }
  });

  state.socket.on('ride_status_change', (ride) => {
    state.currentRide = ride;
    updatePassengerUI(ride);
    updateDriverUI(ride);
    loadAdminMetrics();
  });

  state.socket.on('live_driver_movement', (data) => {
    updateDriverMarkerOnMap(data.location);
  });

  state.socket.on('driver_updated', () => {
    renderOnlineFleetOnPassengerMap();
  });

  state.socket.on('driver_location_changed', () => {
    renderOnlineFleetOnPassengerMap();
  });

  state.socket.on('new_chat_message', (msg) => {
    addChatMessage(msg);
  });
}

function initEventHandlers() {
  document.getElementById('btnCalculateFare').addEventListener('click', async () => {
    const originText = document.getElementById('inputOrigin').value;
    const destText = document.getElementById('inputDestination').value;

    if (!originText || !destText) {
      showToast('Por favor, informe a origem e o destino!', 'warning');
      return;
    }

    const btn = document.getElementById('btnCalculateFare');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Buscando no mapa...';

    const origin = await geocodeAddressText(originText, 'origin');
    const dest = await geocodeAddressText(destText, 'destination');

    btn.innerHTML = '<i class="fa-solid fa-calculator"></i> Calcular Estimativa de Tarifa';

    if (!origin || !dest) {
      showToast('Não foi possível localizar este endereço. Tente clicar direto no mapa!', 'warning');
      return;
    }

    state.lastCalculatedOrigin = origin;
    state.lastCalculatedDestination = dest;

    try {
      const response = await fetch(`${BACKEND_URL}/api/rides/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination: dest })
      });
      const data = await response.json();
      state.fareEstimate = data;

      renderCategoriesGrid(data.options);
      renderRouteOnMap(state.passengerMap, origin, dest, 'passenger');

      document.getElementById('cardBooking').classList.remove('hidden');
      showToast('Estimativa calculada com sucesso!', 'success');
    } catch (err) {
      showToast('Erro ao conectar ao servidor backend. Verifique a porta 4000.', 'warning');
    }
  });

  document.getElementById('btnRequestRide').addEventListener('click', async () => {
    const paymentMethod = document.getElementById('selectPayment').value;
    const selectedOption = state.fareEstimate.options.find(o => o.categoryKey === state.selectedCategory);

    const payload = {
      passengerId: 'pas-1',
      passengerName: 'Fernanda Lima',
      origin: state.lastCalculatedOrigin || LOCATIONS.MASP,
      destination: state.lastCalculatedDestination || LOCATIONS.IBIRAPUERA,
      categoryKey: state.selectedCategory,
      estimatedPrice: selectedOption.price,
      paymentMethod
    };

    try {
      const response = await fetch(`${BACKEND_URL}/api/rides/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const ride = await response.json();
      state.currentRide = ride;

      state.socket.emit('join_ride', ride.id);

      document.getElementById('cardBooking').classList.add('hidden');
      document.getElementById('cardActiveRide').classList.remove('hidden');
      document.getElementById('stateSearching').classList.remove('hidden');
      document.getElementById('matchedDriverInfo').classList.add('hidden');

      document.getElementById('passengerStatus').innerText = 'Procurando Motorista...';
      showToast('Viagem solicitada! Aguardando o motorista aceitar...', 'info');
    } catch (err) {
      showToast('Erro ao solicitar corrida', 'warning');
    }
  });

  document.getElementById('toggleDriverOnline').addEventListener('change', async (e) => {
    const isOnline = e.target.checked;
    const label = document.getElementById('driverStatusLabel');
    label.innerText = isOnline ? 'ONLINE' : 'OFFLINE';
    label.style.color = isOnline ? '#10b981' : '#94a3b8';

    try {
      await fetch(`${BACKEND_URL}/api/drivers/${state.currentDriverId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: isOnline ? 'online' : 'offline' })
      });

      if (isOnline) {
        showToast('🟢 Você agora está ONLINE para receber chamadas!', 'success');
        const resRides = await fetch(`${BACKEND_URL}/api/rides`);
        const ridesList = await resRides.json();
        const searching = ridesList.find(r => r.status === 'SEARCHING');
        if (searching) {
          showRideDispatchModal(searching);
        }
      } else {
        showToast('🔴 Você ficou OFFLINE', 'info');
      }
    } catch (err) {
      showToast('Aviso: Motorista precisa ser APROVADO antes no Painel Admin!', 'warning');
      e.target.checked = false;
      label.innerText = 'OFFLINE';
      label.style.color = '#94a3b8';
    }
  });

  document.getElementById('btnAutoMatch').addEventListener('click', async () => {
    if (!state.currentRide) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/rides/${state.currentRide.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: state.currentDriverId })
      });
      const ride = await res.json();
      state.currentRide = ride;
      state.socket.emit('join_ride', ride.id);

      renderRouteOnMap(state.driverMap, ride.origin, ride.destination, 'driver');
      updateDriverUI(ride);
      startDriverMovementSimulation(ride);
      showToast('⚡ Corrida aceita com sucesso!', 'success');
    } catch (err) {
      showToast('Erro ao aceitar corrida', 'warning');
    }
  });

  document.getElementById('btnAcceptRide').addEventListener('click', async () => {
    stopSirenSound(); // Parar sirene instantaneamente ao clicar em Aceitar

    if (!state.pendingDispatchRide) return;
    const rideId = state.pendingDispatchRide.id;

    clearInterval(state.dispatchTimerInterval);
    document.getElementById('modalRideDispatch').classList.add('hidden');

    try {
      const res = await fetch(`${BACKEND_URL}/api/rides/${rideId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: state.currentDriverId })
      });
      const ride = await res.json();
      state.currentRide = ride;
      state.socket.emit('join_ride', ride.id);

      renderRouteOnMap(state.driverMap, ride.origin, ride.destination, 'driver');
      updateDriverUI(ride);
      startDriverMovementSimulation(ride);
      showToast('🎉 Corrida aceita! Iniciando deslocamento...', 'success');
    } catch (err) {
      showToast('Erro ao aceitar corrida', 'warning');
    }
  });

  document.getElementById('btnRejectRide').addEventListener('click', () => {
    stopSirenSound(); // Parar sirene instantaneamente ao clicar em Recusar
    clearInterval(state.dispatchTimerInterval);
    document.getElementById('modalRideDispatch').classList.add('hidden');
    state.pendingDispatchRide = null;
    showToast('Chamada recusada.', 'info');
  });

  document.getElementById('btnDriverArrived').addEventListener('click', () => {
    updateRideStatus('ARRIVED_PICKUP');
    showToast('📍 Você chegou ao local de embarque!', 'info');
  });
  document.getElementById('btnDriverStart').addEventListener('click', () => {
    updateRideStatus('IN_PROGRESS');
    showToast('🚗 Viagem iniciada! Indo ao destino...', 'success');
  });
  document.getElementById('btnDriverComplete').addEventListener('click', () => {
    updateRideStatus('COMPLETED');
    if (state.simulationInterval) clearInterval(state.simulationInterval);
    showToast('🏁 Viagem concluída com sucesso! Valor creditado.', 'success');
  });

  document.getElementById('btnSendChat').addEventListener('click', sendChatMessage);
  document.getElementById('inputChatMsg').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  document.getElementById('formTariffs').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      basePrice: document.getElementById('cfgBasePrice').value,
      pricePerKm: document.getElementById('cfgPriceKm').value,
      pricePerMin: document.getElementById('cfgPriceMin').value,
      platformFeePercent: document.getElementById('cfgFeePercent').value,
      surgeFactor: document.getElementById('cfgSurge').value
    };

    try {
      await fetch(`${BACKEND_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('⚙️ Novas Tarifas Salvas no Sistema!', 'success');
    } catch (err) {
      showToast('Erro ao salvar tarifas', 'warning');
    }
  });

  document.getElementById('btnOpenModalDriver').addEventListener('click', () => {
    document.getElementById('modalRegisterDriver').classList.remove('hidden');
  });

  document.getElementById('btnOpenModalPassenger').addEventListener('click', () => {
    document.getElementById('modalRegisterPassenger').classList.remove('hidden');
  });

  document.getElementById('selectActiveDriver').addEventListener('change', async (e) => {
    state.currentDriverId = e.target.value;
    try {
      const res = await fetch(`${BACKEND_URL}/api/drivers`);
      const drivers = await res.json();
      const current = drivers.find(d => d.id === state.currentDriverId);
      if (current) {
        const toggle = document.getElementById('toggleDriverOnline');
        const label = document.getElementById('driverStatusLabel');
        const isOnline = current.status === 'online';
        toggle.checked = isOnline;
        label.innerText = isOnline ? 'ONLINE' : 'OFFLINE';
        label.style.color = isOnline ? '#10b981' : '#94a3b8';
        showToast(`Motorista ativo alterado para: ${current.name}`, 'info');
      }
    } catch (err) {
      console.log('Erro ao sincronizar status');
    }
  });

  document.getElementById('formRegisterDriver').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('regDriverName').value,
      phone: document.getElementById('regDriverPhone').value,
      vehicleType: document.getElementById('regDriverType').value,
      vehicleModel: document.getElementById('regDriverModel').value,
      vehicleColor: document.getElementById('regDriverColor').value,
      vehiclePlate: document.getElementById('regDriverPlate').value
    };

    try {
      const res = await fetch(`${BACKEND_URL}/api/drivers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const newDriver = await res.json();
      document.getElementById('modalRegisterDriver').classList.add('hidden');
      document.getElementById('formRegisterDriver').reset();
      
      showToast(`🎉 Motorista "${newDriver.name}" (${newDriver.vehicle.model}) cadastrado! Aprovando no Admin...`, 'success');
      loadAdminDrivers();
    } catch (err) {
      showToast('Erro ao cadastrar motorista', 'warning');
    }
  });

  // Handler de Mapear Zona Promocional / Desconto (Admin)
  document.getElementById('formPromoZone').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('promoName').value,
      discountPercent: document.getElementById('promoDiscount').value,
      validDays: document.getElementById('promoDays').value
    };

    try {
      const res = await fetch(`${BACKEND_URL}/api/promo-zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const zone = await res.json();
      showToast(`🏷️ ${zone.name} (${zone.discountPercent}% OFF) ativada com sucesso!`, 'success');
      document.getElementById('formPromoZone').reset();

      // Desenhar Zona Promocional Dourada no Mapa do Passageiro
      if (state.passengerMap) {
        L.circle([LOCATIONS.MASP.lat, LOCATIONS.MASP.lng], {
          color: '#f59e0b',
          fillColor: '#f59e0b',
          fillOpacity: 0.18,
          radius: 3500
        }).addTo(state.passengerMap).bindPopup(`<b>${zone.name}</b><br>${zone.discountPercent}% OFF (${zone.validDays})`).openPopup();
      }
    } catch (err) {
      showToast('Erro ao criar zona promocional', 'warning');
    }
  });

  document.getElementById('formRegisterPassenger').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('regPassengerName').value;
    document.getElementById('modalRegisterPassenger').classList.add('hidden');
    document.getElementById('formRegisterPassenger').reset();
    showToast(`👤 Perfil de passageiro "${name}" criado com sucesso!`, 'success');
  });
}

function renderCategoriesGrid(options) {
  const container = document.getElementById('categoriesGrid');
  container.innerHTML = '';

  options.forEach((opt, idx) => {
    const isSelected = opt.categoryKey === state.selectedCategory || (idx === 0 && !state.selectedCategory);
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
        <div class="price">R$ ${opt.price.toFixed(2)}</div>
      </div>
    `;
    container.appendChild(div);
  });
}

function renderRouteOnMap(map, origin, destination, role) {
  if (role === 'passenger' && state.routePolylinePassenger) map.removeLayer(state.routePolylinePassenger);
  if (role === 'driver' && state.routePolylineDriver) map.removeLayer(state.routePolylineDriver);

  const points = [
    [origin.lat, origin.lng],
    [destination.lat, destination.lng]
  ];

  L.marker(points[0], { icon: createPinIcon('origin') }).addTo(map);
  L.marker(points[1], { icon: createPinIcon('dest') }).addTo(map);

  const polyline = L.polyline(points, { color: '#3b82f6', weight: 5, opacity: 0.8, dashArray: '8, 8' }).addTo(map);
  map.fitBounds(polyline.getBounds(), { padding: [40, 40] });

  if (role === 'passenger') state.routePolylinePassenger = polyline;
  if (role === 'driver') state.routePolylineDriver = polyline;
}

function showRideDispatchModal(ride) {
  state.pendingDispatchRide = ride;
  
  // Tocar Sirene de Chamada de Emergência por no máximo 5 segundos (ou até o aceite)
  startSirenSound();

  const categoryNames = {
    uberx: '🚗 Econômico (UberX)',
    comfort: '🚘 Comfort',
    moto: '🏍️ Moto Rápidas',
    delivery: '📦 Entregas Flash'
  };

  document.getElementById('dispatchFare').innerText = `R$ ${ride.price.toFixed(2)}`;
  document.getElementById('dispatchCategory').innerText = categoryNames[ride.categoryKey] || '🚗 Corrida';
  document.getElementById('dispatchPassenger').innerText = ride.passengerName;
  document.getElementById('dispatchOrigin').innerText = ride.origin.name;
  document.getElementById('dispatchDest').innerText = ride.destination.name;

  const proxElem = document.getElementById('dispatchProximity');
  if (proxElem) {
    const distKm = ride.nearestDriverDistanceKm || 0.8;
    proxElem.innerHTML = `<i class="fa-solid fa-crosshairs"></i> 📍 Você é o motorista mais próximo (a ${distKm} km do local!)`;
  }

  document.getElementById('modalRideDispatch').classList.remove('hidden');

  let seconds = 15;
  const timerElem = document.getElementById('dispatchTimer');
  timerElem.innerText = `${seconds}s`;

  if (state.dispatchTimerInterval) clearInterval(state.dispatchTimerInterval);

  state.dispatchTimerInterval = setInterval(() => {
    seconds--;
    timerElem.innerText = `${seconds}s`;
    if (seconds <= 0) {
      clearInterval(state.dispatchTimerInterval);
      document.getElementById('modalRideDispatch').classList.add('hidden');
      state.pendingDispatchRide = null;
      stopSirenSound();
    }
  }, 1000);
}

function updatePassengerUI(ride) {
  if (!ride) return;

  if (ride.status === 'SEARCHING') {
    document.getElementById('stateSearching').classList.remove('hidden');
    document.getElementById('matchedDriverInfo').classList.add('hidden');
  } else {
    document.getElementById('stateSearching').classList.add('hidden');
    document.getElementById('matchedDriverInfo').classList.remove('hidden');

    if (ride.driver && ride.driver.vehicle) {
      document.getElementById('rideDriverName').innerText = ride.driver.name;
      document.getElementById('rideDriverRating').innerText = ride.driver.rating;

      const isMoto = ride.categoryKey === 'moto' || ride.driver.vehicle.type === 'moto';
      document.getElementById('rideDriverVehicleType').innerText = isMoto ? '🏍️ Moto' : '🚗 Carro';
      document.getElementById('rideDriverVehicleModel').innerText = `${ride.driver.vehicle.model} (${ride.driver.vehicle.color || 'Preto'})`;
      document.getElementById('rideDriverPlate').innerText = ride.driver.vehicle.plate;
    }

    document.getElementById('rideSummaryPrice').innerText = `R$ ${ride.price.toFixed(2)}`;
    document.getElementById('rideSummaryPay').innerText = ride.paymentMethod.toUpperCase();

    document.querySelectorAll('.ride-progress-bar .step').forEach(s => s.classList.remove('active'));
    if (ride.status === 'ACCEPTED') document.getElementById('stepAccepted').classList.add('active');
    if (ride.status === 'ARRIVED_PICKUP') document.getElementById('stepArrived').classList.add('active');
    if (ride.status === 'IN_PROGRESS') document.getElementById('stepInProgress').classList.add('active');
    if (ride.status === 'COMPLETED') {
      document.getElementById('stepCompleted').classList.add('active');
      document.getElementById('passengerStatus').innerText = 'Viagem Concluída!';
    }
  }
}

function updateDriverUI(ride) {
  if (!ride) return;

  const actionsBox = document.getElementById('driverActions');
  actionsBox.classList.remove('hidden');

  const btnArrived = document.getElementById('btnDriverArrived');
  const btnStart = document.getElementById('btnDriverStart');
  const btnComplete = document.getElementById('btnDriverComplete');

  if (ride.status === 'ACCEPTED') {
    btnArrived.classList.remove('hidden');
    btnStart.classList.add('hidden');
    btnComplete.classList.add('hidden');
  } else if (ride.status === 'ARRIVED_PICKUP') {
    btnArrived.classList.add('hidden');
    btnStart.classList.remove('hidden');
    btnComplete.classList.add('hidden');
  } else if (ride.status === 'IN_PROGRESS') {
    btnArrived.classList.add('hidden');
    btnStart.classList.add('hidden');
    btnComplete.classList.remove('hidden');
  } else if (ride.status === 'COMPLETED') {
    actionsBox.classList.add('hidden');
  }
}

async function updateRideStatus(status) {
  if (!state.currentRide) return;
  try {
    const res = await fetch(`${BACKEND_URL}/api/rides/${state.currentRide.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const updated = await res.json();
    state.currentRide = updated;
    updateDriverUI(updated);
  } catch (err) {
    showToast('Erro ao atualizar status', 'warning');
  }
}

function startDriverMovementSimulation(ride) {
  let steps = 0;
  const maxSteps = 25;

  const startLat = ride.origin.lat;
  const startLng = ride.origin.lng;
  const endLat = ride.destination.lat;
  const endLng = ride.destination.lng;

  if (state.simulationInterval) clearInterval(state.simulationInterval);

  state.simulationInterval = setInterval(() => {
    steps++;
    const progress = steps / maxSteps;

    const currentLat = startLat + (endLat - startLat) * progress;
    const currentLng = startLng + (endLng - startLng) * progress;

    state.socket.emit('update_driver_location', {
      driverId: state.currentDriverId,
      lat: currentLat,
      lng: currentLng,
      heading: 45
    });

    if (steps >= maxSteps) {
      clearInterval(state.simulationInterval);
    }
  }, 1500);
}

function updateDriverMarkerOnMap(location) {
  const latLng = [location.lat, location.lng];

  // Categoria da corrida ativa ou escolhida
  const categoryKey = state.currentRide?.categoryKey || state.selectedCategory || 'uberx';
  const vehicleIcon = createVehicleIcon(categoryKey, location.heading);

  if (!state.driverMarkerPassenger) {
    state.driverMarkerPassenger = L.marker(latLng, { icon: vehicleIcon }).addTo(state.passengerMap);
  } else {
    state.driverMarkerPassenger.setLatLng(latLng);
    state.driverMarkerPassenger.setIcon(vehicleIcon);
  }

  if (!state.driverMarkerDriver) {
    state.driverMarkerDriver = L.marker(latLng, { icon: vehicleIcon }).addTo(state.driverMap);
  } else {
    state.driverMarkerDriver.setLatLng(latLng);
    state.driverMarkerDriver.setIcon(vehicleIcon);
  }
}

function sendChatMessage() {
  const input = document.getElementById('inputChatMsg');
  const text = input.value.trim();
  if (!text || !state.currentRide) return;

  state.socket.emit('send_message', {
    rideId: state.currentRide.id,
    sender: 'passenger',
    text
  });
  input.value = '';
}

function addChatMessage(msg) {
  const box = document.getElementById('chatBox');
  const div = document.createElement('div');
  div.className = `msg ${msg.sender}`;
  div.innerText = `[${msg.time}] ${msg.text}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

window.toggleVerifyDriver = async function(driverId, verified) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/drivers/${driverId}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified })
    });
    const data = await res.json();
    showToast(`🎉 Documentos de "${data.driver?.name || 'Motorista'}" ${verified ? 'APROVADOS com sucesso!' : 'desativados.'}`, verified ? 'success' : 'info');
    loadAdminDrivers();
  } catch (err) {
    showToast('Erro ao alterar verificação do motorista', 'warning');
  }
};

async function loadAdminDrivers() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/drivers`);
    const drivers = await res.json();
    const tbody = document.getElementById('adminDriversTable');
    const selectActive = document.getElementById('selectActiveDriver');

    if (tbody) tbody.innerHTML = '';
    if (selectActive) selectActive.innerHTML = '';

    drivers.forEach(d => {
      if (tbody) {
        const isMoto = d.vehicle?.type === 'moto' || d.vehicle?.type === 'delivery';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${d.name}</strong><br><small style="color: var(--text-muted);">${d.phone}</small></td>
          <td>
            <strong>${isMoto ? '🏍️' : '🚗'} ${d.vehicle?.model || 'Veículo'} (${d.vehicle?.color || 'Preto'})</strong><br>
            <span class="plate-badge-official">${d.vehicle?.plate || 'PLACA'}</span>
          </td>
          <td><span class="badge" style="color: ${d.status === 'online' ? '#10b981' : '#94a3b8'}; font-weight: 700;">${d.status.toUpperCase()}</span></td>
          <td><span style="color: ${d.verified ? '#10b981' : '#f59e0b'}; font-weight: 700;">${d.verified ? '✅ CNH Aprovada' : '⏳ CNH Pendente'}</span></td>
          <td>
            <button class="${d.verified ? 'btn-secondary' : 'btn-success'}" style="padding: 6px 12px; font-size: 0.75rem; font-weight: 700; border-radius: 6px; cursor: pointer;" onclick="window.toggleVerifyDriver('${d.id}', ${!d.verified})">
              ${d.verified ? '❌ Desativar' : '✅ APROVAR AGORA'}
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      }

      if (selectActive) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.innerText = `${d.vehicle?.type === 'moto' ? '🏍️' : '🚗'} ${d.name} (${d.vehicle?.model}) ${d.verified ? '✅ Aprovado' : '⏳ Pendente'}`;
        if (d.id === state.currentDriverId) opt.selected = true;
        selectActive.appendChild(opt);
      }
    });

    document.getElementById('adminTotalDrivers').innerText = drivers.length;
  } catch (err) {
    console.log('Erro ao carregar motoristas');
  }
}

async function loadAdminMetrics() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/rides`);
    const rides = await res.json();

    document.getElementById('adminTotalRides').innerText = rides.length;

    // Calcular Total de Km Rodados no Sistema
    const totalKm = rides.reduce((sum, r) => sum + (r.distanceKm || 0), 0);
    const adminKmElem = document.getElementById('adminTotalKm');
    if (adminKmElem) adminKmElem.innerText = `${totalKm.toFixed(1)} km`;

    // Calcular Faturamento Total da Plataforma
    const totalRev = rides
      .filter(r => r.status === 'COMPLETED')
      .reduce((sum, r) => sum + (r.platformFee || 0), 0);

    document.getElementById('adminPlatformRevenue').innerText = `R$ ${totalRev.toFixed(2)}`;

    // Popular Tabela de Monitoramento de Corridas em Tempo Real com Km
    const ridesTbody = document.getElementById('adminRidesTable');
    if (ridesTbody) {
      ridesTbody.innerHTML = '';

      if (rides.length === 0) {
        ridesTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Nenhuma corrida solicitada no sistema ainda.</td></tr>';
      } else {
        rides.slice().reverse().forEach(r => {
          const catIcons = { uberx: '🚗 Econômico', comfort: '🚘 Comfort', moto: '🏍️ Moto', delivery: '📦 Entrega' };
          const statusColors = { SEARCHING: '#f59e0b', ACCEPTED: '#3b82f6', ARRIVED_PICKUP: '#3b82f6', IN_PROGRESS: '#3b82f6', COMPLETED: '#10b981', CANCELLED: '#ef4444' };
          const statusNames = { SEARCHING: 'Procurando', ACCEPTED: 'Aceita', ARRIVED_PICKUP: 'No Local', IN_PROGRESS: 'Em Viagem', COMPLETED: 'Concluída', CANCELLED: 'Cancelada' };

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${r.passengerName}</strong><br><small>${catIcons[r.categoryKey] || '🚗 Corrida'}</small></td>
            <td><small style="color: var(--success);">${r.origin.name}</small> → <small style="color: var(--danger);">${r.destination.name}</small></td>
            <td><strong style="color: #38bdf8; font-size: 0.9rem;">${r.distanceKm ? r.distanceKm.toFixed(1) : '3.5'} km</strong></td>
            <td><strong style="color: var(--success);">R$ ${r.price ? r.price.toFixed(2) : '0,00'}</strong></td>
            <td>R$ ${r.platformFee ? r.platformFee.toFixed(2) : '0,00'}</td>
            <td><span class="badge" style="color: ${statusColors[r.status] || '#fff'}; font-weight: 700;">${statusNames[r.status] || r.status}</span></td>
          `;
          ridesTbody.appendChild(tr);
        });
      }
    }
  } catch (err) {
    console.log('Erro ao carregar métricas admin');
  }
}
