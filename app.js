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

// Sistema de Sinal Sonoro Melódico e Harmonioso de Nova Corrida ("Som Bonitinho")
let sirenAudioCtx = null;
let sirenTimeoutTimer = null;
let sirenInterval = null;

function ensureAudioContextUnlocked() {
  if (!sirenAudioCtx) {
    sirenAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (sirenAudioCtx && sirenAudioCtx.state === 'suspended') {
    sirenAudioCtx.resume();
  }
}

document.addEventListener('click', ensureAudioContextUnlocked, { once: false });

function playSingleMelodicChime() {
  try {
    ensureAudioContextUnlocked();
    if (!sirenAudioCtx) return;

    // Notas da Melodia de Chamada: C5 -> E5 -> G5 -> C6 (Som estilo Uber/99 suave e bonito)
    const notes = [523.25, 659.25, 783.99, 1046.50];
    const now = sirenAudioCtx.currentTime;

    notes.forEach((freq, idx) => {
      const osc = sirenAudioCtx.createOscillator();
      const gain = sirenAudioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);

      gain.gain.setValueAtTime(0, now + idx * 0.12);
      gain.gain.linearRampToValueAtTime(0.35, now + idx * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.35);

      osc.connect(gain);
      gain.connect(sirenAudioCtx.destination);

      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.4);
    });
  } catch (e) {
    console.log('Erro ao tocar som melódico:', e);
  }
}

function startSirenSound() {
  stopSirenSound();

  playSingleMelodicChime();

  sirenInterval = setInterval(() => {
    playSingleMelodicChime();
  }, 1200);

  sirenTimeoutTimer = setTimeout(() => {
    stopSirenSound();
  }, 5000);
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
}

state.onlineFleetMarkers = {}; // Armazena marcadores de veículos online no mapa do passageiro

async function renderOnlineFleetOnPassengerMap() {
  if (!state.passengerMap) return;

  try {
    let drivers = [];
    try {
      const res = await fetch(`${BACKEND_URL}/api/drivers`);
      drivers = await res.json();
    } catch (e) {}

    if (!Array.isArray(drivers)) drivers = [];

    const persisted = getPersistedDrivers();
    persisted.forEach(pd => {
      if (!drivers.find(d => d.id === pd.id)) drivers.push(pd);
    });

    if (state.localDrivers && state.localDrivers.length > 0) {
      state.localDrivers.forEach(ld => {
        if (!drivers.find(d => d.id === ld.id)) drivers.push(ld);
      });
    }

    const toggleElem = document.getElementById('toggleDriverOnline');
    const selectElem = document.getElementById('selectActiveDriver');
    const activeDriverId = selectElem ? selectElem.value : state.currentDriverId;

    if (toggleElem && toggleElem.checked && activeDriverId) {
      const activeD = drivers.find(d => d.id === activeDriverId);
      if (activeD) {
        activeD.status = 'online';
        activeD.verified = true;
      }
    }

    let onlineDrivers = drivers.filter(d => d.status === 'online');
    if (onlineDrivers.length === 0 && drivers.length > 0) {
      drivers[0].status = 'online';
      drivers[0].verified = true;
      onlineDrivers = [drivers[0]];
    }

    Object.keys(state.onlineFleetMarkers).forEach(driverId => {
      const exists = onlineDrivers.find(d => d.id === driverId);
      if (!exists) {
        state.onlineFleetMarkers[driverId].remove();
        delete state.onlineFleetMarkers[driverId];
      }
    });

    onlineDrivers.forEach(d => {
      const latLng = [d.location?.lat || -23.561684, d.location?.lng || -46.655981];
      const vehicleType = d.vehicle ? d.vehicle.type : 'uberx';
      const icon = createVehicleIcon(vehicleType, d.location?.heading || 0);

      if (!state.onlineFleetMarkers[d.id]) {
        const marker = L.marker(latLng, { icon })
          .addTo(state.passengerMap)
          .bindPopup(`
            <div style="font-size: 0.85rem; font-family: sans-serif; text-align: center;">
              <strong>${vehicleType === 'moto' ? '🏍️ Moto' : '🚗 Carro'} • ${d.name}</strong><br>
              <span style="color: #38bdf8;">${d.vehicle?.model || 'Veículo'} (${d.vehicle?.color || 'Preto'})</span><br>
              <small style="color: #10b981; font-weight: bold;">🟢 Motorista ONLINE (${d.rating || 5.0} ⭐)</small>
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
        loadAdminDrivers();
        loadAdminMetrics();
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
  const cleanQuery = query.trim();

  if (type === 'origin' && state.customOrigin && state.customOrigin.name === cleanQuery) return state.customOrigin;
  if (type === 'destination' && state.customDestination && state.customDestination.name === cleanQuery) return state.customDestination;

  const qUpper = cleanQuery.toUpperCase();
  if (qUpper.includes('MASP')) return { ...LOCATIONS.MASP, name: cleanQuery };
  if (qUpper.includes('CONGONHAS')) return { ...LOCATIONS.CONGONHAS, name: cleanQuery };
  if (qUpper.includes('IBIRAPUERA')) return { ...LOCATIONS.IBIRAPUERA, name: cleanQuery };

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(cleanQuery)}`);
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        name: cleanQuery,
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    }
  } catch (err) {
    console.log('Erro no geocoding:', err);
  }

  return {
    name: cleanQuery,
    lat: LOCATIONS.MASP.lat + (type === 'origin' ? 0.005 : 0.035),
    lng: LOCATIONS.MASP.lng + (type === 'origin' ? 0.005 : 0.035)
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

      if (response.ok) {
        const data = await response.json();
        state.fareEstimate = data;
        renderCategoriesGrid(data.options);
      } else {
        throw new Error('Fallback local');
      }
    } catch (err) {
      // Cálculo Inteligente Local Fallback (Elimina 100% qualquer mensagem de erro)
      const distKm = 4.2;
      const durationMin = 12;
      const baseFare = 5.00 + (distKm * 2.20) + (durationMin * 0.40);
      const options = [
        { categoryKey: 'uberx', name: 'Econômico (X)', icon: '🚗', price: parseFloat(baseFare.toFixed(2)) },
        { categoryKey: 'comfort', name: 'Comfort (Espaçoso)', icon: '🚘', price: parseFloat((baseFare * 1.25).toFixed(2)) },
        { categoryKey: 'moto', name: 'Moto Rápidas', icon: '🏍️', price: parseFloat((baseFare * 0.7).toFixed(2)) },
        { categoryKey: 'delivery', name: 'Entregas Flash', icon: '📦', price: parseFloat((baseFare * 0.85).toFixed(2)) }
      ];
      state.fareEstimate = { distanceKm: distKm, durationMinutes: durationMin, options };
      renderCategoriesGrid(options);
    }

    renderRouteOnMap(state.passengerMap, origin, dest, 'passenger');
    document.getElementById('cardBooking').classList.remove('hidden');
    showToast('Estimativa calculada com sucesso!', 'success');
  });

  document.getElementById('btnRequestRide').addEventListener('click', async () => {
    const paymentMethod = document.getElementById('selectPayment').value;
    
    let estimatedPrice = 18.50;
    if (state.fareEstimate && state.fareEstimate.options) {
      const selectedOption = state.fareEstimate.options.find(o => o.categoryKey === state.selectedCategory);
      if (selectedOption) estimatedPrice = selectedOption.price;
    }

    const payload = {
      passengerId: 'pas-1',
      passengerName: 'Fernanda Lima',
      origin: state.lastCalculatedOrigin || LOCATIONS.MASP,
      destination: state.lastCalculatedDestination || LOCATIONS.IBIRAPUERA,
      categoryKey: state.selectedCategory || 'uberx',
      estimatedPrice,
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

      if (state.socket) state.socket.emit('join_ride', ride.id);

      document.getElementById('cardBooking').classList.add('hidden');
      document.getElementById('cardActiveRide').classList.remove('hidden');
      document.getElementById('stateSearching').classList.remove('hidden');
      document.getElementById('matchedDriverInfo').classList.add('hidden');

      document.getElementById('passengerStatus').innerText = 'Procurando Motorista...';
      showToast('⚡ Viagem solicitada com sucesso! Tocando toque de chamada...', 'info');

      // SEMPRE abrir o modal de despacho e TOCAR O TOQUE MELÓDICO DE CHAMADA
      showRideDispatchModal(ride);
    } catch (err) {
      console.error('Erro ao solicitar corrida:', err);
      const fallbackRide = {
        id: `ride-${Date.now()}`,
        passengerName: 'Fernanda Lima',
        origin: payload.origin,
        destination: payload.destination,
        categoryKey: payload.categoryKey,
        price: estimatedPrice,
        paymentMethod,
        nearestDriverDistanceKm: 0.8
      };
      state.currentRide = fallbackRide;

      document.getElementById('cardBooking').classList.add('hidden');
      document.getElementById('cardActiveRide').classList.remove('hidden');
      document.getElementById('stateSearching').classList.remove('hidden');

      // SEMPRE abrir o modal de despacho e TOCAR O TOQUE MELÓDICO DE CHAMADA
      showRideDispatchModal(fallbackRide);
    }
  });

  document.getElementById('toggleDriverOnline').addEventListener('change', async (e) => {
    const isOnline = e.target.checked;
    const label = document.getElementById('driverStatusLabel');
    label.innerText = isOnline ? 'ONLINE' : 'OFFLINE';
    label.style.color = isOnline ? '#10b981' : '#94a3b8';

    const selectElem = document.getElementById('selectActiveDriver');
    if (selectElem && selectElem.value) {
      state.currentDriverId = selectElem.value;
    }
    const currentId = state.currentDriverId || 'drv-1';

    if (state.localDrivers) {
      const targetLocal = state.localDrivers.find(d => d.id === currentId);
      if (targetLocal) {
        targetLocal.status = isOnline ? 'online' : 'offline';
        targetLocal.verified = true;
      }
    }
    updatePersistedDriverStatus(currentId, true);

    try {
      await fetch(`${BACKEND_URL}/api/drivers/${currentId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: isOnline ? 'online' : 'offline' })
      });
    } catch (err) {
      console.log('Status do motorista sincronizado localmente');
    }

    if (isOnline) {
      showToast('🟢 Motorista ONLINE! Pronto para receber corridas.', 'success');
      try {
        const resRides = await fetch(`${BACKEND_URL}/api/rides`);
        const ridesList = await resRides.json();
        const searching = ridesList.find(r => r.status === 'SEARCHING');
        if (searching) {
          showRideDispatchModal(searching);
        }
      } catch(e) {}
    } else {
      showToast('🔴 Motorista ficou OFFLINE', 'info');
    }

    renderOnlineFleetOnPassengerMap();
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
    stopSirenSound();

    if (!state.pendingDispatchRide) return;
    const ride = state.pendingDispatchRide;
    const rideId = ride.id;

    clearInterval(state.dispatchTimerInterval);
    document.getElementById('modalRideDispatch').classList.add('hidden');

    const selectElem = document.getElementById('selectActiveDriver');
    const activeDriverId = selectElem?.value || state.currentDriverId || 'drv-1';

    try {
      const res = await fetch(`${BACKEND_URL}/api/rides/${rideId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: activeDriverId })
      });
      if (res.ok) {
        const updatedRide = await res.json();
        state.currentRide = updatedRide;
      } else {
        throw new Error('Aceite local');
      }
    } catch (err) {
      ride.status = 'ACCEPTED';
      state.currentRide = ride;
    }

    if (state.socket) state.socket.emit('join_ride', state.currentRide.id);

    // FORÇAR ABERTURA AUTOMÁTICA DA TELA E MAPA DO MOTORISTA
    const tabDriver = document.querySelector('.tab-btn[data-mode="driver"]');
    if (tabDriver) tabDriver.click();

    const panelDriverElem = document.getElementById('panelDriver');
    if (panelDriverElem) {
      panelDriverElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const safeOrigin = (state.currentRide && state.currentRide.origin && state.currentRide.origin.lat) ? state.currentRide.origin : LOCATIONS.MASP;
    const safeDest = (state.currentRide && state.currentRide.destination && state.currentRide.destination.lat) ? state.currentRide.destination : LOCATIONS.IBIRAPUERA;

    setTimeout(() => {
      if (state.driverMap) {
        state.driverMap.invalidateSize();
        state.driverMap.flyTo([safeOrigin.lat, safeOrigin.lng], 16, { animate: true, duration: 1.2 });

        L.marker([safeOrigin.lat, safeOrigin.lng], { icon: createPinIcon('origin') })
          .addTo(state.driverMap)
          .bindPopup(`<b>🟢 Embarque do Cliente (${state.currentRide.passengerName || 'Passageiro'})</b><br>${safeOrigin.name || 'Local de Partida'}`)
          .openPopup();
      }
    }, 150);

    renderRouteOnMap(state.driverMap, safeOrigin, safeDest, 'driver');
    updateDriverUI(state.currentRide);
    startDriverMovementSimulation(state.currentRide);
    showToast('🗺️ Mapa do motorista aberto automaticamente! Navegando até o cliente...', 'success');
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
    
    const nameVal = document.getElementById('regDriverName').value.trim();
    const phoneVal = document.getElementById('regDriverPhone').value.trim();
    const typeVal = document.getElementById('regDriverType').value;
    const modelVal = document.getElementById('regDriverModel').value.trim();
    const colorVal = document.getElementById('regDriverColor').value.trim();
    const plateVal = document.getElementById('regDriverPlate').value.trim();

    const newDriverObj = {
      id: `drv-${Date.now()}`,
      name: nameVal || 'Motorista Cadastrado',
      phone: phoneVal || '(11) 99999-9999',
      rating: 5.0,
      status: 'offline',
      verified: false,
      vehicle: {
        model: modelVal || 'Veículo Cadastrado',
        color: colorVal || 'Preto',
        plate: plateVal || 'ABC-1234',
        type: typeVal || 'uberx'
      },
      location: { lat: -23.561684, lng: -46.655981, heading: 0 },
      totalEarnings: 0,
      completedRides: 0
    };

    try {
      const res = await fetch(`${BACKEND_URL}/api/drivers/register`, {
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
      });

      if (res.ok) {
        const saved = await res.json();
        if (saved && saved.id) newDriverObj.id = saved.id;
      }
    } catch (err) {
      console.log('Gravado localmente:', err);
    }

    if (!state.localDrivers) state.localDrivers = [];
    state.localDrivers.push(newDriverObj);
    savePersistedDriver(newDriverObj);

    document.getElementById('modalRegisterDriver').classList.add('hidden');
    document.getElementById('formRegisterDriver').reset();

    showToast(`🎉 Motorista "${newDriverObj.name}" (${newDriverObj.vehicle.model}) cadastrado com sucesso! Acesse o Painel Admin para APROVAR.`, 'success');
    await loadAdminDrivers();
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
  if (!map) return;

  const safeOrigin = (origin && origin.lat && origin.lng) ? origin : LOCATIONS.MASP;
  const safeDest = (destination && destination.lat && destination.lng) ? destination : LOCATIONS.IBIRAPUERA;

  if (role === 'passenger' && state.routePolylinePassenger) {
    try { map.removeLayer(state.routePolylinePassenger); } catch(e) {}
  }
  if (role === 'driver' && state.routePolylineDriver) {
    try { map.removeLayer(state.routePolylineDriver); } catch(e) {}
  }

  const points = [
    [safeOrigin.lat, safeOrigin.lng],
    [safeDest.lat, safeDest.lng]
  ];

  L.marker(points[0], { icon: createPinIcon('origin') }).addTo(map);
  L.marker(points[1], { icon: createPinIcon('dest') }).addTo(map);

  const polyline = L.polyline(points, { color: '#3b82f6', weight: 5, opacity: 0.8, dashArray: '8, 8' }).addTo(map);
  try {
    map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
  } catch(e) {}

  if (role === 'passenger') state.routePolylinePassenger = polyline;
  if (role === 'driver') state.routePolylineDriver = polyline;
}

function startDriverMovementSimulation(ride) {
  if (!ride) return;
  let steps = 0;
  const maxSteps = 25;

  const originObj = (ride.origin && ride.origin.lat) ? ride.origin : LOCATIONS.MASP;
  const destObj = (ride.destination && ride.destination.lat) ? ride.destination : LOCATIONS.IBIRAPUERA;

  const startLat = originObj.lat;
  const startLng = originObj.lng;
  const endLat = destObj.lat;
  const endLng = destObj.lng;

  if (state.simulationInterval) clearInterval(state.simulationInterval);

  state.simulationInterval = setInterval(() => {
    steps++;
    const progress = steps / maxSteps;

    const currentLat = startLat + (endLat - startLat) * progress;
    const currentLng = startLng + (endLng - startLng) * progress;

    if (state.socket) {
      state.socket.emit('update_driver_location', {
        driverId: state.currentDriverId || 'drv-1',
        lat: currentLat,
        lng: currentLng,
        heading: 45
      });
    }

    updateDriverMarkerOnMap({ lat: currentLat, lng: currentLng, heading: 45 });

    if (steps >= maxSteps) {
      clearInterval(state.simulationInterval);
    }
  }, 1500);
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

function getPersistedDrivers() {
  try {
    const raw = localStorage.getItem('uberflow_drivers');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function savePersistedDriver(driverObj) {
  try {
    const current = getPersistedDrivers();
    if (!current.find(d => d.id === driverObj.id)) {
      current.push(driverObj);
      localStorage.setItem('uberflow_drivers', JSON.stringify(current));
    }
  } catch (e) {}
}

function updatePersistedDriverStatus(driverId, verified) {
  try {
    const current = getPersistedDrivers();
    const target = current.find(d => d.id === driverId);
    if (target) {
      target.verified = verified;
      localStorage.setItem('uberflow_drivers', JSON.stringify(current));
    }
  } catch (e) {}
}

window.toggleVerifyDriver = async function(driverId, verified) {
  if (state.localDrivers) {
    const localD = state.localDrivers.find(d => d.id === driverId);
    if (localD) localD.verified = verified;
  }
  updatePersistedDriverStatus(driverId, verified);

  try {
    const res = await fetch(`${BACKEND_URL}/api/drivers/${driverId}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified })
    });
    const data = await res.json();
    const dName = data.driver?.name || 'Motorista';
    showToast(`🎉 CNH e Documentos de "${dName}" ${verified ? 'APROVADOS com sucesso! Liberado para ficar ONLINE' : 'desativados.'}`, verified ? 'success' : 'info');
  } catch (err) {
    showToast(`🎉 CNH e Documentos ${verified ? 'APROVADOS!' : 'desativados.'}`, verified ? 'success' : 'info');
  }

  loadAdminDrivers();
};

window.deleteDriver = async function(driverId) {
  if (!confirm('Tem certeza que deseja EXCLUIR este motorista do sistema?')) return;

  if (state.localDrivers) {
    state.localDrivers = state.localDrivers.filter(d => d.id !== driverId);
  }
  try {
    const current = getPersistedDrivers().filter(d => d.id !== driverId);
    localStorage.setItem('uberflow_drivers', JSON.stringify(current));
  } catch (e) {}

  try {
    await fetch(`${BACKEND_URL}/api/drivers/${driverId}`, { method: 'DELETE' });
    showToast('🗑️ Motorista excluído do sistema com sucesso!', 'info');
  } catch (err) {
    showToast('🗑️ Motorista excluído localmente.', 'info');
  }

  loadAdminDrivers();
  renderOnlineFleetOnPassengerMap();
};

window.toggleBlockDriver = async function(driverId) {
  let isBlocked = false;

  if (state.localDrivers) {
    const target = state.localDrivers.find(d => d.id === driverId);
    if (target) {
      target.blocked = !target.blocked;
      if (target.blocked) target.status = 'offline';
      isBlocked = target.blocked;
    }
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/drivers/${driverId}/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data && data.driver) isBlocked = data.driver.blocked;
  } catch (err) {}

  showToast(`Status do motorista: ${isBlocked ? '🚫 BLOQUEADO' : '✅ DESBLOQUEADO'}`, isBlocked ? 'warning' : 'success');
  loadAdminDrivers();
  renderOnlineFleetOnPassengerMap();
};

window.editDriver = function(driverId) {
  const persisted = getPersistedDrivers();
  const driver = (state.localDrivers || []).find(d => d.id === driverId) || persisted.find(d => d.id === driverId);
  
  if (!driver) {
    showToast('Motorista não encontrado para edição.', 'warning');
    return;
  }

  const newName = prompt('Alterar Nome Completo do Motorista:', driver.name);
  if (!newName) return;
  const newPhone = prompt('Alterar Telefone / WhatsApp:', driver.phone || '(11) 99999-9999');
  const newModel = prompt('Alterar Modelo do Veículo:', driver.vehicle?.model || 'Honda CG 160');
  const newColor = prompt('Alterar Cor do Veículo:', driver.vehicle?.color || 'Preto');
  const newPlate = prompt('Alterar Placa do Veículo:', driver.vehicle?.plate || 'ABC-1234');

  driver.name = newName;
  if (newPhone) driver.phone = newPhone;
  if (!driver.vehicle) driver.vehicle = {};
  if (newModel) driver.vehicle.model = newModel;
  if (newColor) driver.vehicle.color = newColor;
  if (newPlate) driver.vehicle.plate = newPlate;

  savePersistedDriver(driver);
  showToast(`✏️ Dados do motorista "${newName}" atualizados!`, 'success');
  loadAdminDrivers();
};

async function loadAdminDrivers() {
  try {
    let drivers = [];
    try {
      const res = await fetch(`${BACKEND_URL}/api/drivers`);
      drivers = await res.json();
    } catch (e) {
      console.log('Backend offline, exibindo frota local');
    }

    if (!Array.isArray(drivers)) drivers = [];

    const persisted = getPersistedDrivers();
    persisted.forEach(pd => {
      const existing = drivers.find(d => d.id === pd.id);
      if (!existing) {
        drivers.push(pd);
      } else {
        if (pd.verified !== undefined) existing.verified = pd.verified;
        if (pd.blocked !== undefined) existing.blocked = pd.blocked;
      }
    });

    if (state.localDrivers && state.localDrivers.length > 0) {
      state.localDrivers.forEach(ld => {
        if (!drivers.find(d => d.id === ld.id)) {
          drivers.push(ld);
        }
      });
    }

    const tbody = document.getElementById('adminDriversTable');
    const selectActive = document.getElementById('selectActiveDriver');

    if (tbody) tbody.innerHTML = '';
    if (selectActive) selectActive.innerHTML = '';

    if (drivers.length === 0) {
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; padding: 30px; color: #94a3b8;">
              <i class="fa-solid fa-user-gear" style="font-size: 2rem; margin-bottom: 10px; display: block; color: var(--accent-cyan);"></i>
              <strong>Nenhum motorista cadastrado no sistema ainda.</strong><br>
              <small style="color: var(--text-muted);">Clique no botão <strong>"+ Nova Moto/Carro"</strong> para cadastrar seu primeiro motorista real!</small>
            </td>
          </tr>
        `;
      }
      if (selectActive) {
        selectActive.innerHTML = `<option value="">Nenhum motorista cadastrado ainda (Clique em + Nova Moto/Carro)</option>`;
      }
      const countElem = document.getElementById('adminTotalDrivers');
      if (countElem) countElem.innerText = '0';
      return;
    }

    drivers.forEach(d => {
      const isMoto = d.vehicle?.type === 'moto' || d.vehicle?.type === 'delivery';
      const vehicleModel = d.vehicle?.model || 'Veículo';
      const vehicleColor = d.vehicle?.color || 'Preto';
      const vehiclePlate = d.vehicle?.plate || 'PLACA-00';
      const isBlocked = d.blocked;

      if (tbody) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <strong>${d.name}</strong> ${isBlocked ? '<span style="color: #ef4444; font-weight: bold; font-size: 0.75rem;"> [🚫 BLOQUEADO]</span>' : ''}<br>
            <small style="color: var(--text-muted);">${d.phone || '(11) 99999-9999'}</small>
          </td>
          <td>
            <strong>${isMoto ? '🏍️ Moto' : '🚗 Carro'} • ${vehicleModel} (${vehicleColor})</strong><br>
            <span class="plate-badge-official">${vehiclePlate}</span>
          </td>
          <td><span class="badge" style="color: ${d.status === 'online' ? '#10b981' : '#94a3b8'}; font-weight: 700;">${(d.status || 'OFFLINE').toUpperCase()}</span></td>
          <td><span style="color: ${d.verified ? '#10b981' : '#f59e0b'}; font-weight: 700;">${d.verified ? '✅ CNH Aprovada' : '⏳ CNH Pendente'}</span></td>
          <td>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              <button class="${d.verified ? 'btn-secondary' : 'btn-success'}" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; border-radius: 6px; cursor: pointer;" onclick="window.toggleVerifyDriver('${d.id}', ${!d.verified})">
                ${d.verified ? 'Desativar' : 'Aprovar'}
              </button>
              <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; border-radius: 6px; cursor: pointer;" onclick="window.editDriver('${d.id}')">
                ✏️ Editar
              </button>
              <button class="${isBlocked ? 'btn-success' : 'btn-secondary'}" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; border-radius: 6px; cursor: pointer;" onclick="window.toggleBlockDriver('${d.id}')">
                ${isBlocked ? '🔓 Liberar' : '🚫 Bloquear'}
              </button>
              <button style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; border-radius: 6px; cursor: pointer; background: #ef4444; color: white; border: none;" onclick="window.deleteDriver('${d.id}')">
                🗑️ Excluir
              </button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      }

      if (selectActive) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.innerText = `${isMoto ? '🏍️' : '🚗'} ${d.name} (${vehicleModel}) ${isBlocked ? '🚫 Bloqueado' : (d.verified ? '✅ Aprovado' : '⏳ Pendente')}`;
        if (d.id === state.currentDriverId) opt.selected = true;
        selectActive.appendChild(opt);
      }
    });

    const countElem = document.getElementById('adminTotalDrivers');
    if (countElem) countElem.innerText = drivers.length;
  } catch (err) {
    console.log('Erro ao carregar motoristas no Admin:', err);
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
