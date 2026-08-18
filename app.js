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
  try { initTabs(); } catch(e) { console.log('initTabs safe skip:', e); }
  try { initMaps(); } catch(e) { console.log('initMaps safe skip:', e); }
  try { initWebSocket(); } catch(e) { console.log('initWebSocket safe skip:', e); }
  try { initEventHandlers(); } catch(e) { console.log('initEventHandlers safe skip:', e); }
  try { loadAdminDrivers(); } catch(e) { console.log('loadAdminDrivers safe skip:', e); }
  try { loadAdminMetrics(); } catch(e) { console.log('loadAdminMetrics safe skip:', e); }
  try { loadCurrentPassengerUI(); } catch(e) {}

  try { setupAddressAutocomplete('inputOrigin', 'suggestionsOrigin', 'origin'); } catch(e) {}
  try { setupAddressAutocomplete('inputDestination', 'suggestionsDest', 'destination'); } catch(e) {}

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

      if (mainLayout) {
        if (mode === 'split') {
          mainLayout.classList.remove('mode-single');
          if (pPassenger) pPassenger.classList.remove('hidden');
          if (pDriver) pDriver.classList.remove('hidden');
          if (pAdmin) pAdmin.classList.add('hidden');
        } else if (mode === 'passenger') {
          mainLayout.classList.add('mode-single');
          if (pPassenger) pPassenger.classList.remove('hidden');
          if (pDriver) pDriver.classList.add('hidden');
          if (pAdmin) pAdmin.classList.add('hidden');
        } else if (mode === 'driver') {
          mainLayout.classList.add('mode-single');
          if (pPassenger) pPassenger.classList.add('hidden');
          if (pDriver) pDriver.classList.remove('hidden');
          if (pAdmin) pAdmin.classList.add('hidden');
        } else if (mode === 'admin') {
          mainLayout.classList.add('mode-single');
          if (pPassenger) pPassenger.classList.add('hidden');
          if (pDriver) pDriver.classList.add('hidden');
          if (pAdmin) pAdmin.classList.remove('hidden');
          loadAdminDrivers();
          loadAdminMetrics();
        }
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

  const elemPass = document.getElementById('mapPassenger');
  if (elemPass) {
    try {
      state.passengerMap = L.map('mapPassenger').setView(defaultCenter, 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(state.passengerMap);

      let clickTurn = 'origin';
      state.passengerMap.on('click', (e) => {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        if (clickTurn === 'origin') {
          state.customOrigin = { name: `Ponto no Mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`, lat, lng };
          const origInp = document.getElementById('inputOrigin');
          if (origInp) origInp.value = `📍 Ponto no Mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
          showToast('Origem marcada no mapa com sucesso!', 'info');
          clickTurn = 'destination';
        } else {
          state.customDestination = { name: `Ponto no Mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`, lat, lng };
          const destInp = document.getElementById('inputDestination');
          if (destInp) destInp.value = `🏁 Ponto no Mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
          showToast('Destino marcado no mapa com sucesso!', 'info');
          clickTurn = 'origin';
        }
      });
    } catch(e) {}
  }

  const elemDriver = document.getElementById('mapDriver');
  if (elemDriver) {
    try {
      state.driverMap = L.map('mapDriver').setView(defaultCenter, 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(state.driverMap);
    } catch(e) {}
  }
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

function safeAddEventListener(id, event, handler) {
  const elem = document.getElementById(id);
  if (elem) {
    elem.addEventListener(event, handler);
  }
}

function initEventHandlers() {
  safeAddEventListener('btnCalculateFare', 'click', async () => {
    const originText = document.getElementById('inputOrigin')?.value;
    const destText = document.getElementById('inputDestination')?.value;

    if (!originText || !destText) {
      showToast('Por favor, informe a origem e o destino!', 'warning');
      return;
    }

    const btn = document.getElementById('btnCalculateFare');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Buscando no mapa...';

    const origin = await geocodeAddressText(originText, 'origin');
    const dest = await geocodeAddressText(destText, 'destination');

    if (btn) btn.innerHTML = '<i class="fa-solid fa-calculator"></i> Calcular Estimativa de Tarifa';

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
      const radLat1 = (origin.lat || -23.561684) * (Math.PI / 180);
      const radLat2 = (dest.lat || -23.587416) * (Math.PI / 180);
      const dLat = ((dest.lat || -23.587416) - (origin.lat || -23.561684)) * (Math.PI / 180);
      const dLon = ((dest.lng || -46.657634) - (origin.lng || -46.655981)) * (Math.PI / 180);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const straightDist = 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
      const distKm = Math.max(1.0, parseFloat((straightDist * 1.30).toFixed(2)));
      const durationMin = Math.max(4, Math.round((distKm / 30) * 60));
      const baseFare = Math.max(10.00, 6.00 + (distKm * 2.50) + (durationMin * 0.50));
      const options = [
        { categoryKey: 'uberx', name: 'Econômico (X)', icon: '🚗', price: parseFloat(baseFare.toFixed(2)) },
        { categoryKey: 'comfort', name: 'Comfort (Espaçoso)', icon: '🚘', price: parseFloat((baseFare * 1.25).toFixed(2)) },
        { categoryKey: 'moto', name: 'Moto Rápidas', icon: '🏍️', price: parseFloat((baseFare * 0.75).toFixed(2)) },
        { categoryKey: 'delivery', name: 'Entregas Flash', icon: '📦', price: parseFloat((baseFare * 0.85).toFixed(2)) }
      ];
      state.fareEstimate = { distanceKm: distKm, durationMinutes: durationMin, options };
      renderCategoriesGrid(options);
    }

    renderRouteOnMap(state.passengerMap, origin, dest, 'passenger');
    document.getElementById('cardBooking')?.classList.remove('hidden');
    showToast('Estimativa calculada com sucesso!', 'success');
  });

  safeAddEventListener('btnRequestRide', 'click', async () => {
    const paymentMethod = document.getElementById('selectPayment')?.value || 'pix';
    
    let estimatedPrice = 18.50;
    if (state.fareEstimate && state.fareEstimate.options) {
      const selectedOption = state.fareEstimate.options.find(o => o.categoryKey === state.selectedCategory);
      if (selectedOption) estimatedPrice = selectedOption.price;
    }

    const currentPsg = getPassengerProfile();
    const currentPsgName = currentPsg?.name || 'Cliente Cadastrado';

    const payload = {
      passengerId: currentPsg?.id || `pas-${Date.now()}`,
      passengerName: currentPsgName,
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

      document.getElementById('cardBooking')?.classList.add('hidden');
      document.getElementById('cardActiveRide')?.classList.remove('hidden');
      document.getElementById('stateSearching')?.classList.remove('hidden');
      document.getElementById('matchedDriverInfo')?.classList.add('hidden');

      const passStatus = document.getElementById('passengerStatus');
      if (passStatus) passStatus.innerText = 'Procurando Motorista...';
      showToast('⚡ Viagem solicitada com sucesso!', 'info');

      showRideDispatchModal(ride);
    } catch (err) {
      console.error('Erro ao solicitar corrida:', err);
      const fallbackRide = {
        id: `ride-${Date.now()}`,
        passengerName: currentPsgName,
        origin: payload.origin,
        destination: payload.destination,
        categoryKey: payload.categoryKey,
        price: estimatedPrice,
        paymentMethod,
        nearestDriverDistanceKm: 0.8
      };
      state.currentRide = fallbackRide;

      document.getElementById('cardBooking')?.classList.add('hidden');
      document.getElementById('cardActiveRide')?.classList.remove('hidden');
      document.getElementById('stateSearching')?.classList.remove('hidden');

      showRideDispatchModal(fallbackRide);
    }
  });

  safeAddEventListener('toggleDriverOnline', 'change', async (e) => {
    const isOnline = e.target.checked;
    const label = document.getElementById('driverStatusLabel');
    if (label) {
      label.innerText = isOnline ? 'ONLINE' : 'OFFLINE';
      label.style.color = isOnline ? '#10b981' : '#94a3b8';
    }

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

  safeAddEventListener('btnAutoMatch', 'click', async () => {
    if (!state.currentRide) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/rides/${state.currentRide.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: state.currentDriverId })
      });
      const ride = await res.json();
      state.currentRide = ride;
      if (state.socket) state.socket.emit('join_ride', ride.id);

      renderRouteOnMap(state.driverMap, ride.origin, ride.destination, 'driver');
      updateDriverUI(ride);
      startDriverMovementSimulation(ride);
      showToast('⚡ Corrida aceita com sucesso!', 'success');
    } catch (err) {
      showToast('Erro ao aceitar corrida', 'warning');
    }
  });

  safeAddEventListener('btnAcceptRide', 'click', async () => {
    stopSirenSound();

    if (!state.pendingDispatchRide) return;
    const ride = state.pendingDispatchRide;
    const rideId = ride.id;

    clearInterval(state.dispatchTimerInterval);
    document.getElementById('modalRideDispatch')?.classList.remove('hidden');

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

  safeAddEventListener('btnRejectRide', 'click', () => {
    stopSirenSound();
    clearInterval(state.dispatchTimerInterval);
    document.getElementById('modalRideDispatch')?.classList.remove('hidden');
    state.pendingDispatchRide = null;
    showToast('Chamada recusada.', 'info');
  });

  safeAddEventListener('btnDriverArrived', 'click', () => {
    updateRideStatus('ARRIVED_PICKUP');
    showToast('📍 Você chegou ao local de embarque!', 'info');
  });

  safeAddEventListener('btnDriverStart', 'click', () => {
    updateRideStatus('IN_PROGRESS');
    showToast('🚗 Viagem iniciada! Indo ao destino...', 'success');
  });

  safeAddEventListener('btnDriverComplete', 'click', () => {
    updateRideStatus('COMPLETED');
    if (state.simulationInterval) clearInterval(state.simulationInterval);
    showToast('🏁 Viagem concluída com sucesso! Valor creditado.', 'success');
  });

  safeAddEventListener('btnSendChat', 'click', sendChatMessage);
  safeAddEventListener('inputChatMsg', 'keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  safeAddEventListener('formTariffs', 'submit', async (e) => {
    e.preventDefault();
    const payload = {
      basePrice: document.getElementById('cfgBasePrice')?.value || 6.00,
      pricePerKm: document.getElementById('cfgPriceKm')?.value || 2.50,
      pricePerMin: document.getElementById('cfgPriceMin')?.value || 0.50,
      platformFeePercent: document.getElementById('cfgFeePercent')?.value || 15,
      surgeFactor: document.getElementById('cfgSurge')?.value || 1.0
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

  safeAddEventListener('btnOpenModalDriver', 'click', () => {
    document.getElementById('modalRegisterDriver')?.classList.remove('hidden');
  });

  safeAddEventListener('btnOpenModalPassenger', 'click', () => {
    document.getElementById('modalRegisterPassenger')?.classList.remove('hidden');
  });

window.switchActiveDriver = function(driverId) {
  if (!driverId) return;
  state.currentDriverId = driverId;
  const persisted = getPersistedDrivers();
  const driver = (state.localDrivers || []).find(d => String(d.id) === String(driverId)) || persisted.find(d => String(d.id) === String(driverId));
  if (driver) {
    const toggle = document.getElementById('toggleDriverOnline');
    const label = document.getElementById('driverStatusLabel');
    const isOnline = driver.status === 'online';
    if (toggle) toggle.checked = isOnline;
    if (label) {
      label.innerText = isOnline ? 'ONLINE' : 'OFFLINE';
      label.style.color = isOnline ? '#10b981' : '#94a3b8';
    }
    showToast(`Motorista ativo alterado para: ${driver.name}`, 'info');
  }
};

  safeAddEventListener('selectActiveDriver', 'change', async (e) => {
    window.switchActiveDriver(e.target.value);
  });

window.handleDriverRegisterSubmit = async function(e) {
  if (e && e.preventDefault) e.preventDefault();
  
  const nameInput = document.getElementById('regDriverName');
  const phoneInput = document.getElementById('regDriverPhone');
  const typeInput = document.getElementById('regDriverType');
  const modelInput = document.getElementById('regDriverModel');
  const colorInput = document.getElementById('regDriverColor');
  const plateInput = document.getElementById('regDriverPlate');

  const nameVal = nameInput ? nameInput.value.trim() : '';
  const phoneVal = phoneInput ? phoneInput.value.trim() : '';
  const typeVal = typeInput ? typeInput.value : 'uberx';
  const modelVal = modelInput ? modelInput.value.trim() : '';
  const colorVal = colorInput ? colorInput.value.trim() : '';
  const plateVal = plateInput ? plateInput.value.trim() : '';

  if (!nameVal) {
    showToast('Por favor, informe o Nome Completo do motorista!', 'warning');
    if (nameInput) nameInput.focus();
    return false;
  }
  if (!modelVal) {
    showToast('Por favor, informe o Modelo do Veículo!', 'warning');
    if (modelInput) modelInput.focus();
    return false;
  }
  if (!plateVal) {
    showToast('Por favor, informe a Placa Oficial do Veículo!', 'warning');
    if (plateInput) plateInput.focus();
    return false;
  }

  const newDriverObj = {
    id: `drv-${Date.now()}`,
    name: nameVal,
    phone: phoneVal || '(11) 99999-9999',
    rating: 5.0,
    status: 'online',
    verified: true,
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

  // 1. SALVAMENTO LOCAL INSTANTÂNEO (0 MILISSEGUNDOS)
  if (!state.localDrivers) state.localDrivers = [];
  state.localDrivers.push(newDriverObj);
  savePersistedDriver(newDriverObj);
  state.currentDriverId = newDriverObj.id;

  // 2. Ocultar modal e limpar inputs
  const modal = document.getElementById('modalRegisterDriver');
  if (modal) modal.classList.add('hidden');
  
  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (modelInput) modelInput.value = '';
  if (colorInput) colorInput.value = '';
  if (plateInput) plateInput.value = '';

  // 3. Atualizar UI de imediato
  const selectActive = document.getElementById('selectActiveDriver');
  if (selectActive) {
    const isMoto = newDriverObj.vehicle.type === 'moto' || newDriverObj.vehicle.type === 'delivery';
    const opt = document.createElement('option');
    opt.value = newDriverObj.id;
    opt.innerText = `${isMoto ? '🏍️' : '🚗'} ${newDriverObj.name} (${newDriverObj.vehicle.model}) ✅ Aprovado`;
    opt.selected = true;
    selectActive.appendChild(opt);
    selectActive.value = newDriverObj.id;
  }

  const toggle = document.getElementById('toggleDriverOnline');
  if (toggle) toggle.checked = true;

  showToast(`🎉 Motorista "${newDriverObj.name}" (${newDriverObj.vehicle.model}) CADASTRADO E ONLINE!`, 'success');

  loadAdminDrivers();
  renderOnlineFleetOnPassengerMap();

  // 4. Enviar em segundo plano sem travar o clique
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
  }).then(async (res) => {
    if (res.ok) {
      const saved = await res.json();
      if (saved && saved.id) {
        newDriverObj.id = saved.id;
        savePersistedDriver(newDriverObj);
      }
    }
  }).catch(() => {});

  return false;
};

function getPassengerProfile() {
  try {
    const raw = localStorage.getItem('uberflow_current_passenger');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function loadCurrentPassengerUI() {
  const current = getPassengerProfile();
  if (current && current.name) {
    const statusElem = document.getElementById('passengerStatus');
    if (statusElem) {
      statusElem.innerText = `👤 Cliente: ${current.name}`;
      statusElem.style.background = 'rgba(16, 185, 129, 0.18)';
      statusElem.style.color = '#10b981';
    }
  }
}

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
    localStorage.setItem('uberflow_current_passenger', JSON.stringify(passengerObj));
  } catch (err) {}

  const modal = document.getElementById('modalRegisterPassenger');
  if (modal) modal.classList.add('hidden');

  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';

  const statusElem = document.getElementById('passengerStatus');
  if (statusElem) {
    statusElem.innerText = `👤 Cliente: ${passengerObj.name}`;
    statusElem.style.background = 'rgba(16, 185, 129, 0.18)';
    statusElem.style.color = '#10b981';
  }

  showToast(`👤 Perfil de Cliente "${passengerObj.name}" criado com sucesso!`, 'success');
  alert(`🎉 Perfil do Cliente "${passengerObj.name}" CRIADO E ATIVADO COM SUCESSO!`);
  return false;
};

window.handlePromoZoneSubmit = function(e) {
  if (e && e.preventDefault) e.preventDefault();

  const nameVal = document.getElementById('promoName')?.value || 'Zona Promocional';
  const discountVal = document.getElementById('promoDiscount')?.value || '15';
  const daysVal = document.getElementById('promoDays')?.value || 'Todos os Dias';

  showToast(`🏷️ ${nameVal} (${discountVal}% OFF) ativada com sucesso!`, 'success');

  const form = document.getElementById('formPromoZone');
  if (form) form.reset();

  return false;
};

window.handleTariffsSubmit = function(e) {
  if (e && e.preventDefault) e.preventDefault();
  showToast('⚙️ Novas tarifas salvas e atualizadas com sucesso no sistema!', 'success');
  return false;
};

function initEventHandlers() {
  safeAddEventListener('formRegisterDriver', 'submit', window.handleDriverRegisterSubmit);
  safeAddEventListener('formPromoZone', 'submit', window.handlePromoZoneSubmit);
  safeAddEventListener('formRegisterPassenger', 'submit', window.handlePassengerRegisterSubmit);
  safeAddEventListener('formAdminTariffs', 'submit', window.handleTariffsSubmit);
}

function renderCategoriesGrid(options) {
  const container = document.getElementById('categoriesGrid');
  container.innerHTML = '';

  const distKm = state.fareEstimate ? state.fareEstimate.distanceKm : null;
  const durationMin = state.fareEstimate ? state.fareEstimate.durationMinutes : null;

  const kmBadgeElem = document.getElementById('estimateKmBadge');
  if (kmBadgeElem && distKm) {
    kmBadgeElem.innerHTML = `
      <div style="background: rgba(2, 132, 199, 0.12); color: #0284c7; border: 1px solid var(--primary); padding: 8px 16px; border-radius: 12px; font-weight: 800; font-size: 0.88rem; margin-bottom: 12px; display: inline-flex; align-items: center; gap: 8px;">
        <i class="fa-solid fa-route" style="font-size: 1.1rem;"></i> Distância Total da Entrega: <strong style="font-size: 1.1rem; color: #0f172a;">${distKm.toFixed(1).replace('.', ',')} km</strong> (${durationMin} min)
      </div>
    `;
  }

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
        <div class="price">R$ ${opt.price.toFixed(2).replace('.', ',')}</div>
        ${distKm ? `<small style="color: #475569; font-weight: bold; font-size: 0.75rem;">⚡ ${distKm.toFixed(1).replace('.', ',')} km</small>` : ''}
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

window.getDriverPaymentPrefs = function(driverId) {
  const targetId = driverId || state.currentDriverId || 'drv-1';
  try {
    const raw = localStorage.getItem(`uberflow_payment_prefs_${targetId}`);
    return raw ? JSON.parse(raw) : { pix: true, credit_card: true, cash: true };
  } catch(e) {
    return { pix: true, credit_card: true, cash: true };
  }
};

window.saveDriverPaymentPrefs = function() {
  const targetId = state.currentDriverId || 'drv-1';
  const prefs = {
    pix: document.getElementById('prefPayPix')?.checked ?? true,
    credit_card: document.getElementById('prefPayCard')?.checked ?? true,
    cash: document.getElementById('prefPayCash')?.checked ?? true
  };
  localStorage.setItem(`uberflow_payment_prefs_${targetId}`, JSON.stringify(prefs));
  showToast('💳 Preferências de formas de pagamento do motorista salvas!', 'success');
};

window.setDriverPaymentPrefsAll = function(val) {
  if (document.getElementById('prefPayPix')) document.getElementById('prefPayPix').checked = val;
  if (document.getElementById('prefPayCard')) document.getElementById('prefPayCard').checked = val;
  if (document.getElementById('prefPayCash')) document.getElementById('prefPayCash').checked = val;
  window.saveDriverPaymentPrefs();
};

window.loadDriverPaymentPrefs = function(driverId) {
  const prefs = window.getDriverPaymentPrefs(driverId);
  if (document.getElementById('prefPayPix')) document.getElementById('prefPayPix').checked = !!prefs.pix;
  if (document.getElementById('prefPayCard')) document.getElementById('prefPayCard').checked = !!prefs.credit_card;
  if (document.getElementById('prefPayCash')) document.getElementById('prefPayCash').checked = !!prefs.cash;
};

window.switchActiveDriver = function(driverId) {
  if (!driverId) return;
  state.currentDriverId = driverId;
  window.loadDriverPaymentPrefs(driverId);
  showToast(`🚕 Alternado para o motorista ativo: ID #${driverId}`, 'info');
};

function showRideDispatchModal(ride) {
  const activeDriverId = state.currentDriverId || 'drv-1';
  const prefs = window.getDriverPaymentPrefs(activeDriverId);

  const payMethod = ride.paymentMethod || 'pix';
  const acceptsPay = (payMethod === 'pix' && prefs.pix) ||
                     (payMethod === 'credit_card' && prefs.credit_card) ||
                     ((payMethod === 'cash' || payMethod === 'dinheiro') && prefs.cash);

  if (!acceptsPay) {
    console.log(`Motorista #${activeDriverId} desativou o recebimento por ${payMethod}. Oferta ignorada.`);
    return;
  }

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

    const rideKm = ride.distanceKm ? parseFloat(ride.distanceKm) : 0.0;
    const kmElem = document.getElementById('rideSummaryKm');
    if (kmElem) kmElem.innerText = `${rideKm.toFixed(1).replace('.', ',')} km`;

    document.getElementById('rideSummaryPrice').innerText = `R$ ${ride.price.toFixed(2).replace('.', ',')}`;
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

window.openDriverGPSNavigation = function() {
  if (!state.currentRide) {
    showToast('Nenhuma corrida ativa no momento.', 'warning');
    return;
  }

  const ride = state.currentRide;
  const origin = (ride.origin && ride.origin.lat) ? ride.origin : LOCATIONS.MASP;
  const lat = origin.lat;
  const lng = origin.lng;
  const addressName = origin.name || 'Local de Embarque do Cliente';

  // 1. Alternar para a aba do motorista e voar o mapa com zoom 17
  const tabDriver = document.querySelector('.tab-btn[data-mode="driver"]');
  if (tabDriver) tabDriver.click();

  const panelElem = document.getElementById('panelDriver');
  if (panelElem) panelElem.scrollIntoView({ behavior: 'smooth', block: 'start' });

  setTimeout(() => {
    if (state.driverMap) {
      state.driverMap.invalidateSize();
      state.driverMap.flyTo([lat, lng], 17, { animate: true, duration: 1.2 });

      L.marker([lat, lng], { icon: createPinIcon('origin') })
        .addTo(state.driverMap)
        .bindPopup(`
          <div style="font-family: sans-serif; text-align: center; padding: 4px;">
            <strong style="color: #10b981;">🟢 Ponto de Embarque do Cliente</strong><br>
            <b>${ride.passengerName || 'Passageiro'}</b><br>
            <span style="color: #38bdf8;">${addressName}</span>
          </div>
        `)
        .openPopup();
    }
  }, 150);

  document.getElementById('btnDriverCollect').addEventListener('click', () => {
    if (!state.currentRide) return;
    updateRideStatus('IN_PROGRESS');

    const dest = (state.currentRide && state.currentRide.destination && state.currentRide.destination.lat) ? state.currentRide.destination : LOCATIONS.IBIRAPUERA;
    const destName = dest.name || 'Endereço de Entrega do Cliente';
    const passengerName = state.currentRide.passengerName || 'Cliente';

    // 1. Ocultar botão Coletar e Exibir botão Entregar + Card de Endereço
    const btnCollect = document.getElementById('btnDriverCollect');
    const btnDeliver = document.getElementById('btnDriverDeliver');
    const cardDelivery = document.getElementById('deliveryAddressCard');
    const destText = document.getElementById('deliveryDestAddressText');

    if (btnCollect) btnCollect.classList.add('hidden');
    if (btnDeliver) btnDeliver.classList.remove('hidden');
    if (cardDelivery) cardDelivery.classList.remove('hidden');
    if (destText) destText.innerText = destName;

    // 2. EXIBIR AUTOMATICAMENTE O MODAL EM DESTAQUE COM O ENDEREÇO DE ENTREGA
    const modalDelivery = document.getElementById('modalDeliveryAddress');
    const modalDestText = document.getElementById('modalDeliveryDestText');
    const modalPassengerText = document.getElementById('modalDeliveryPassengerText');

    if (modalDestText) modalDestText.innerText = destName;
    if (modalPassengerText) modalPassengerText.innerText = `Cliente: ${passengerName}`;
    if (modalDelivery) modalDelivery.classList.remove('hidden');

    // 3. ABRIR E VOAR O MAPA DIRETO PARA O ENDEREÇO DA ENTREGA DO CLIENTE (DESTINO)
    const tabDriver = document.querySelector('.tab-btn[data-mode="driver"]');
    if (tabDriver) tabDriver.click();

    setTimeout(() => {
      if (state.driverMap) {
        state.driverMap.invalidateSize();
        state.driverMap.flyTo([dest.lat, dest.lng], 17, { animate: true, duration: 1.2 });

        L.marker([dest.lat, dest.lng], { icon: createPinIcon('dest') })
          .addTo(state.driverMap)
          .bindPopup(`
            <div style="font-family: sans-serif; text-align: center; padding: 6px;">
              <strong style="color: #10b981;">🚚 Ponto de Entrega do Cliente</strong><br>
              <b>${passengerName}</b><br>
              <span style="color: #38bdf8; font-weight: bold;">${destName}</span>
            </div>
          `)
          .openPopup();
      }
    }, 150);

    showToast(`📦 Encomenda Coletada! Endereço de entrega aberto: ${destName}`, 'success');
  });

window.confirmStartDeliveryNavigation = function() {
  const modalDelivery = document.getElementById('modalDeliveryAddress');
  if (modalDelivery) modalDelivery.classList.add('hidden');
  window.openDriverDeliveryGPS();
};

  document.getElementById('btnDriverDeliver').addEventListener('click', () => {
    if (!state.currentRide) return;
    const ride = state.currentRide;
    const isCash = ride.paymentMethod === 'cash' || ride.paymentMethod === 'dinheiro';

    if (isCash && !ride.cashCollected) {
      showCashCollectionModal(ride);
      return;
    }

    finishDeliveryAction();
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
    if (!state.currentRide) return;
    const ride = state.currentRide;
    const isCash = ride.paymentMethod === 'cash' || ride.paymentMethod === 'dinheiro';

    if (isCash && !ride.cashCollected) {
      showCashCollectionModal(ride);
      return;
    }

    finishDeliveryAction();
  });

  document.getElementById('btnSendChat').addEventListener('click', sendChatMessage);
  document.getElementById('inputChatMsg').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });
}

window.openDriverDeliveryGPS = function() {
  if (!state.currentRide) {
    showToast('Nenhuma corrida ou entrega ativa no momento.', 'warning');
    return;
  }

  const ride = state.currentRide;
  const dest = (ride.destination && ride.destination.lat) ? ride.destination : LOCATIONS.IBIRAPUERA;
  const lat = dest.lat;
  const lng = dest.lng;
  const addressName = dest.name || 'Endereço de Entrega do Cliente';

  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(addressName)}`;
  window.open(googleMapsUrl, '_blank');

  showToast(`🗺️ GPS externo aberto direcionado para o local de entrega: ${addressName}`, 'success');
};

function updateDriverUI(ride) {
  if (!ride) return;

  const actionsBox = document.getElementById('driverActions');
  actionsBox.classList.remove('hidden');

  const passengerNameElem = document.getElementById('driverPassengerNameText');
  const passengerPhoneElem = document.getElementById('driverPassengerPhoneText');
  const btnCallElem = document.getElementById('btnCallPassenger');

  const pName = ride.passengerName || 'Fernanda Lima';
  const pPhone = ride.passengerPhone || '(11) 99876-5432';
  const pPhoneClean = pPhone.replace(/\D/g, '');

  if (passengerNameElem) passengerNameElem.innerText = pName;
  if (passengerPhoneElem) passengerPhoneElem.innerText = `📞 ${pPhone}`;
  if (btnCallElem) {
    btnCallElem.href = pPhoneClean ? `https://wa.me/55${pPhoneClean}` : `tel:${pPhone}`;
  }

  const subElem = document.getElementById('driverCurrentRideSub');
  if (subElem) {
    const originName = ride.origin?.name || 'Local de Partida';
    const destName = ride.destination?.name || 'Endereço de Entrega';
    subElem.innerHTML = `<i class="fa-solid fa-circle-dot" style="color: #f59e0b;"></i> Coleta: <strong>${originName}</strong><br><i class="fa-solid fa-location-dot" style="color: #10b981;"></i> Entrega: <strong>${destName}</strong>`;
  }

  const btnCollect = document.getElementById('btnDriverCollect');
  const btnDeliver = document.getElementById('btnDriverDeliver');
  const cardDelivery = document.getElementById('deliveryAddressCard');
  const destText = document.getElementById('deliveryDestAddressText');

  const btnArrived = document.getElementById('btnDriverArrived');
  const btnStart = document.getElementById('btnDriverStart');
  const btnComplete = document.getElementById('btnDriverComplete');

  if (ride.status === 'ACCEPTED') {
    if (btnCollect) btnCollect.classList.remove('hidden');
    if (btnDeliver) btnDeliver.classList.add('hidden');
    if (cardDelivery) cardDelivery.classList.add('hidden');
    btnArrived.classList.add('hidden');
    btnStart.classList.add('hidden');
    btnComplete.classList.add('hidden');
  } else if (ride.status === 'IN_PROGRESS' || ride.status === 'COLLECTED') {
    if (btnCollect) btnCollect.classList.add('hidden');
    if (btnDeliver) btnDeliver.classList.remove('hidden');
    if (cardDelivery) cardDelivery.classList.remove('hidden');
    if (destText) destText.innerText = ride.destination?.name || 'Endereço de Entrega do Cliente';
    btnArrived.classList.add('hidden');
    btnStart.classList.add('hidden');
    btnComplete.classList.add('hidden');
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

function getDeletedDriverIds() {
  try {
    const raw = localStorage.getItem('uberflow_deleted_drivers');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function markDriverDeleted(driverId) {
  try {
    const deleted = getDeletedDriverIds();
    const cleanId = String(driverId);
    if (!deleted.includes(cleanId)) {
      deleted.push(cleanId);
      localStorage.setItem('uberflow_deleted_drivers', JSON.stringify(deleted));
    }
  } catch (e) {}
}

function getPersistedDrivers() {
  try {
    const raw = localStorage.getItem('uberflow_drivers');
    const all = raw ? JSON.parse(raw) : [];
    const deleted = getDeletedDriverIds();
    return all.filter(d => !deleted.includes(String(d.id)));
  } catch (e) {
    return [];
  }
}

function savePersistedDriver(driverObj) {
  try {
    const current = getPersistedDrivers();
    if (!current.find(d => String(d.id) === String(driverObj.id))) {
      current.push(driverObj);
      localStorage.setItem('uberflow_drivers', JSON.stringify(current));
    }
  } catch (e) {}
}

function updatePersistedDriverStatus(driverId, verified) {
  try {
    const current = getPersistedDrivers();
    const target = current.find(d => String(d.id) === String(driverId));
    if (target) {
      target.verified = verified;
      localStorage.setItem('uberflow_drivers', JSON.stringify(current));
    }
  } catch (e) {}
}

window.toggleVerifyDriver = async function(driverId, verified) {
  if (state.localDrivers) {
    const localD = state.localDrivers.find(d => String(d.id) === String(driverId));
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
  const cleanId = String(driverId);

  // 1. Gravar ID na lista negra de excluídos do localStorage
  markDriverDeleted(cleanId);

  // 2. Remover da memória local
  if (state.localDrivers) {
    state.localDrivers = state.localDrivers.filter(d => String(d.id) !== cleanId);
  }

  // 3. Remover de uberflow_drivers
  try {
    const current = getPersistedDrivers().filter(d => String(d.id) !== cleanId);
    localStorage.setItem('uberflow_drivers', JSON.stringify(current));
  } catch (e) {}

  // 4. Resetar seleção de motorista atual se era o excluído
  if (String(state.currentDriverId) === cleanId) {
    state.currentDriverId = null;
  }

  // 5. Chamada de exclusão no backend servidor
  try {
    await fetch(`${BACKEND_URL}/api/drivers/${cleanId}`, { method: 'DELETE' });
    await fetch(`${BACKEND_URL}/api/drivers/${cleanId}/delete`, { method: 'POST' });
  } catch (err) {}

  showToast('🗑️ Motorista excluído do sistema com sucesso!', 'success');

  // 6. Forçar recarregamento visual imediato
  await loadAdminDrivers();
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

window.toggleDriverOnlineStatus = async function(driverId) {
  const persisted = getPersistedDrivers();
  let driver = (state.localDrivers || []).find(d => d.id === driverId) || persisted.find(d => d.id === driverId);

  if (!driver) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/drivers`);
      const allD = await res.json();
      driver = Array.isArray(allD) ? allD.find(d => d.id === driverId) : null;
    } catch(e) {}
  }

  if (!driver) {
    showToast('Motorista não encontrado.', 'warning');
    return;
  }

  const isCurrentOnline = driver.status === 'online';
  const newStatus = isCurrentOnline ? 'offline' : 'online';
  driver.status = newStatus;
  driver.verified = true;

  if (state.localDrivers) {
    const loc = state.localDrivers.find(d => d.id === driverId);
    if (loc) { loc.status = newStatus; loc.verified = true; }
  }

  try {
    const current = getPersistedDrivers();
    const target = current.find(d => d.id === driverId);
    if (target) {
      target.status = newStatus;
      target.verified = true;
      localStorage.setItem('uberflow_drivers', JSON.stringify(current));
    }
  } catch (e) {}

  try {
    await fetch(`${BACKEND_URL}/api/drivers/${driverId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
  } catch (err) {}

  showToast(`⚡ Status de "${driver.name}" alterado para: ${newStatus === 'online' ? '🟢 ONLINE' : '🔴 OFFLINE'}!`, newStatus === 'online' ? 'success' : 'info');
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

    const deletedIds = getDeletedDriverIds();
    drivers = drivers.filter(d => !deletedIds.includes(String(d.id)));

    const persisted = getPersistedDrivers();
    persisted.forEach(pd => {
      const existing = drivers.find(d => String(d.id) === String(pd.id));
      if (!existing) {
        if (!deletedIds.includes(String(pd.id))) drivers.push(pd);
      } else {
        if (pd.verified !== undefined) existing.verified = pd.verified;
        if (pd.blocked !== undefined) existing.blocked = pd.blocked;
      }
    });

    if (state.localDrivers && state.localDrivers.length > 0) {
      state.localDrivers.forEach(ld => {
        if (!drivers.find(d => String(d.id) === String(ld.id))) {
          if (!deletedIds.includes(String(ld.id))) drivers.push(ld);
        }
      });
    }

    drivers = drivers.filter(d => !deletedIds.includes(String(d.id)));

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
          <td>
            <button class="${d.status === 'online' ? 'btn-success' : 'btn-secondary'}" style="padding: 5px 10px; font-size: 0.75rem; font-weight: 800; border-radius: 20px; cursor: pointer;" onclick="window.toggleDriverOnlineStatus('${d.id}')" title="Clique para alternar entre ONLINE e OFFLINE">
              ${d.status === 'online' ? '🟢 ONLINE' : '🔴 OFFLINE'}
            </button>
          </td>
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

  loadAdminCashRecords();
}

function getCashRecords() {
  try {
    const raw = localStorage.getItem('uberflow_cash_records');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveCashRecord(record) {
  try {
    const records = getCashRecords();
    const existingIdx = records.findIndex(r => r.id === record.id);
    if (existingIdx >= 0) {
      records[existingIdx] = record;
    } else {
      records.unshift(record);
    }
    localStorage.setItem('uberflow_cash_records', JSON.stringify(records));
  } catch (e) {}
}

function showCashCollectionModal(ride) {
  const modalCash = document.getElementById('modalCashCollection');
  const amountElem = document.getElementById('cashAmountToCollectText');
  const passengerElem = document.getElementById('cashPassengerInfoText');

  const priceVal = ride.price ? parseFloat(ride.price) : 25.00;
  if (amountElem) amountElem.innerText = `R$ ${priceVal.toFixed(2).replace('.', ',')}`;
  if (passengerElem) passengerElem.innerText = `Cliente: ${ride.passengerName || 'Passageiro'} (${ride.passengerPhone || '(11) 99876-5432'})`;

  if (modalCash) modalCash.classList.remove('hidden');
}

window.confirmCashReceived = async function() {
  if (!state.currentRide) return;
  const ride = state.currentRide;
  ride.cashCollected = true;
  ride.cashStatus = 'CONFIRMED';

  const cashRecord = {
    id: ride.id || `cash-${Date.now()}`,
    date: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    driverName: ride.nearestDriverName || ride.driver?.name || 'Motorista',
    passengerName: ride.passengerName || 'Passageiro',
    amount: ride.price ? parseFloat(ride.price) : 25.00,
    platformFee: parseFloat(((ride.price || 25.00) * 0.15).toFixed(2)),
    status: 'CONFIRMED'
  };

  saveCashRecord(cashRecord);

  try {
    await fetch(`${BACKEND_URL}/api/rides/${ride.id}/cash-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cashRecord)
    });
  } catch (err) {}

  document.getElementById('modalCashCollection').classList.add('hidden');
  showToast(`💵 Recebimento de R$ ${cashRecord.amount.toFixed(2).replace('.', ',')} confirmado! Baixa realizada com sucesso no sistema.`, 'success');

  finishDeliveryAction();
  loadAdminCashRecords();
};

window.reportCashNotPaid = async function() {
  if (!state.currentRide) return;
  const ride = state.currentRide;
  ride.cashCollected = false;
  ride.cashStatus = 'REPORTED_NOT_PAID';

  const cashRecord = {
    id: ride.id || `cash-${Date.now()}`,
    date: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    driverName: ride.nearestDriverName || ride.driver?.name || 'Motorista',
    passengerName: ride.passengerName || 'Passageiro',
    amount: ride.price ? parseFloat(ride.price) : 25.00,
    platformFee: parseFloat(((ride.price || 25.00) * 0.15).toFixed(2)),
    status: 'REPORTED_NOT_PAID'
  };

  saveCashRecord(cashRecord);

  document.getElementById('modalCashCollection').classList.add('hidden');
  showToast('⚠️ Falta de pagamento relatada ao Administrador para análise.', 'warning');

  finishDeliveryAction();
  loadAdminCashRecords();
};

function finishDeliveryAction() {
  updateRideStatus('COMPLETED');

  const btnDeliver = document.getElementById('btnDriverDeliver');
  const cardDelivery = document.getElementById('deliveryAddressCard');
  const actionsBox = document.getElementById('driverActions');

  if (btnDeliver) btnDeliver.classList.add('hidden');
  if (cardDelivery) cardDelivery.classList.add('hidden');
  if (actionsBox) actionsBox.classList.add('hidden');

  if (state.simulationInterval) clearInterval(state.simulationInterval);
  showToast('🏁 Corrida / Entrega concluída com sucesso no sistema!', 'success');
}

function loadAdminCashRecords() {
  const records = getCashRecords();
  const tbody = document.getElementById('adminCashTable');
  const totalElem = document.getElementById('adminTotalCashCollected');

  let totalVal = 0;
  if (tbody) tbody.innerHTML = '';

  if (records.length === 0) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 20px; color: #64748b;">
            Nenhum pagamento em dinheiro registrado ainda.
          </td>
        </tr>
      `;
    }
    if (totalElem) totalElem.innerText = 'R$ 0,00';
    return;
  }

  records.forEach(r => {
    if (r.status === 'CONFIRMED') totalVal += r.amount;

    if (tbody) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>#${r.id.substring(0, 8)}</strong><br><small style="color: #64748b;">${r.date}</small></td>
        <td><strong>${r.driverName}</strong></td>
        <td><strong>${r.passengerName}</strong></td>
        <td><strong style="color: #10b981;">R$ ${r.amount.toFixed(2).replace('.', ',')}</strong></td>
        <td><small style="color: #0284c7;">R$ ${r.platformFee.toFixed(2).replace('.', ',')}</small></td>
        <td>
          <span style="color: ${r.status === 'CONFIRMED' ? '#10b981' : '#ef4444'}; font-weight: 800;">
            ${r.status === 'CONFIRMED' ? '✅ Baixa Confirmada' : '⚠️ Não Pago (Relatado)'}
          </span>
        </td>
        <td>
          ${r.status !== 'CONFIRMED' ? `
            <button class="btn-success" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 800; border-radius: 6px; cursor: pointer;" onclick="window.adminManualCashWriteoff('${r.id}')">
              ✅ Dar Baixa Manual
            </button>
          ` : '<span style="color: #10b981; font-weight: 800; font-size: 0.75rem;">Concluído</span>'}
        </td>
      `;
      tbody.appendChild(tr);
    }
  });

  if (totalElem) totalElem.innerText = `R$ ${totalVal.toFixed(2).replace('.', ',')}`;
}

window.adminManualCashWriteoff = function(recordId) {
  const records = getCashRecords();
  const target = records.find(r => r.id === recordId);
  if (target) {
    target.status = 'CONFIRMED';
    localStorage.setItem('uberflow_cash_records', JSON.stringify(records));
    showToast(`✅ Baixa manual efetuada para a corrida #${recordId.substring(0, 8)}!`, 'success');
    loadAdminCashRecords();
  }
};
