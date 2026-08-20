const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const DATA_FILE = path.join(__dirname, '99_app_database.json');

// Configurações Globais da 99 Super-App Brasil
let systemConfig = {
  appName: '99 Super-App Brasil',
  basePrice: 6.00,
  pricePerKm: 2.50,
  pricePerMin: 0.50,
  platformFeePercent: 15,
  surgeFactor: 1.0,
  categories: {
    pop: { name: '🟡 99Pop (Econômico)', multiplier: 1.0, icon: '🟡' },
    comfort: { name: '🚘 99Comfort (Espaçoso)', multiplier: 1.25, icon: '🚘' },
    moto: { name: '🏍️ 99Moto (Viagens Rápidas)', multiplier: 0.70, icon: '🏍️' },
    delivery: { name: '📦 99Entrega Flash', multiplier: 0.80, icon: '📦' },
    taxi: { name: '🚕 99Táxi Oficial', multiplier: 1.35, icon: '🚕' }
  },
  promoZones: [],
  supportPerson: {
    name: 'Suporte Oficial 99 24h',
    phone: '5511999998888'
  }
};

// BANCO DE DADOS LIMPO SEM DADOS FAKES (APENAS MOTORISTAS CADASTRADOS PELO USUÁRIO)
let drivers = [];
let passengers = [];
let rides = [];

// BUSCAR CONFIGURAÇÕES DE TARIFAS E ZONAS PROMOCIONAIS
app.get('/api/config', (req, res) => {
  res.json(systemConfig);
});

// ATUALIZAR TARIFAS E TAXAS DA PLATAFORMA
app.post('/api/config/fares', (req, res) => {
  const { basePrice, pricePerKm, pricePerMin, platformFeePercent, surgeFactor } = req.body;
  if (basePrice !== undefined) systemConfig.basePrice = parseFloat(basePrice);
  if (pricePerKm !== undefined) systemConfig.pricePerKm = parseFloat(pricePerKm);
  if (pricePerMin !== undefined) systemConfig.pricePerMin = parseFloat(pricePerMin);
  if (platformFeePercent !== undefined) systemConfig.platformFeePercent = parseFloat(platformFeePercent);
  if (surgeFactor !== undefined) systemConfig.surgeFactor = parseFloat(surgeFactor);

  saveDataToDisk();
  io.emit('config_updated', systemConfig);
  res.json({ message: 'Tarifas atualizadas com sucesso!', systemConfig });
});

// ATUALIZAR CONTATO DO ATENDENTE DE SUPORTE WHATSAPP
app.post('/api/config/support', (req, res) => {
  const { name, phone } = req.body;
  if (!systemConfig.supportPerson) systemConfig.supportPerson = {};
  if (name) systemConfig.supportPerson.name = name;
  if (phone) systemConfig.supportPerson.phone = String(phone).replace(/\D/g, '');

  saveDataToDisk();
  io.emit('config_updated', systemConfig);
  res.json({ message: 'Atendente de Suporte salvo com sucesso!', supportPerson: systemConfig.supportPerson });
});

// ADICIONAR OU ATUALIZAR ZONA PROMOCIONAL / DINÂMICA
app.post('/api/config/promo-zones', (req, res) => {
  const { name, surgeFactor, driverBonus, passengerDiscount } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome da zona é obrigatório' });

  if (!systemConfig.promoZones) systemConfig.promoZones = [];

  const newZone = {
    id: `zone-${Date.now()}`,
    name,
    surgeFactor: parseFloat(surgeFactor || 1.0),
    driverBonus: parseFloat(driverBonus || 0),
    passengerDiscount: parseFloat(passengerDiscount || 0),
    active: true,
    createdAt: new Date()
  };

  systemConfig.promoZones.push(newZone);
  if (newZone.surgeFactor > systemConfig.surgeFactor) {
    systemConfig.surgeFactor = newZone.surgeFactor;
  }

  saveDataToDisk();
  io.emit('config_updated', systemConfig);
  res.json({ message: 'Zona promocional ativada com sucesso!', zone: newZone, systemConfig });
});

// REMOVER / DESATIVAR ZONA PROMOCIONAL
app.delete('/api/config/promo-zones/:id', (req, res) => {
  if (systemConfig.promoZones) {
    systemConfig.promoZones = systemConfig.promoZones.filter(z => String(z.id) !== String(req.params.id));
    const activeSurges = systemConfig.promoZones.filter(z => z.active).map(z => z.surgeFactor);
    systemConfig.surgeFactor = activeSurges.length > 0 ? Math.max(...activeSurges) : 1.0;
  }
  saveDataToDisk();
  io.emit('config_updated', systemConfig);
  res.json({ message: 'Zona desativada com sucesso', systemConfig });
});

function saveDataToDisk() {
  try {
    const data = { drivers, rides, systemConfig, passengers };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Erro ao salvar dados no disco:', err);
  }
}

function loadDataFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.drivers)) drivers = data.drivers;
      if (Array.isArray(data.rides)) rides = data.rides;
      if (data.systemConfig) systemConfig = data.systemConfig;
      if (Array.isArray(data.passengers)) passengers = data.passengers;
      console.log('📦 Banco de Dados 99 limpo carregado!');
    }
  } catch (err) {
    console.error('Erro ao carregar dados do disco:', err);
  }
}

loadDataFromDisk();

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straight = R * c;
  return parseFloat((straight * 1.30).toFixed(2));
}

// REST Endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', app: '99 Super-App Engine v3.0', timestamp: new Date() });
});

app.get('/api/drivers', (req, res) => res.json(drivers));

app.post('/api/drivers/register', (req, res) => {
  const { name, phone, vehicleType, vehicleModel, vehicleColor, vehiclePlate } = req.body;
  if (!name || !vehicleModel || !vehiclePlate) {
    return res.status(400).json({ error: 'Nome, modelo e placa são obrigatórios' });
  }

  const newDriver = {
    id: `drv-${Date.now()}`,
    name,
    phone: phone || '(11) 99999-9999',
    rating: 5.0,
    status: 'online',
    verified: true,
    blocked: false,
    vehicle: {
      model: vehicleModel,
      color: vehicleColor || 'Preto',
      plate: vehiclePlate,
      type: vehicleType || 'pop'
    },
    location: { lat: -23.561684 + (Math.random() - 0.5) * 0.01, lng: -46.655981 + (Math.random() - 0.5) * 0.01, heading: 0 },
    totalEarnings: 0,
    completedRides: 0
  };

  drivers.push(newDriver);
  saveDataToDisk();
  io.emit('driver_registered', newDriver);
  res.status(201).json(newDriver);
});

// EDITAR DADOS DO MOTORISTA
app.put('/api/drivers/:id', (req, res) => {
  const driver = drivers.find(d => String(d.id) === String(req.params.id));
  if (!driver) return res.status(404).json({ error: 'Motorista não encontrado' });

  const { name, phone, vehicleModel, vehicleColor, vehiclePlate, vehicleType, verified } = req.body;
  if (name) driver.name = name;
  if (phone) driver.phone = phone;
  if (!driver.vehicle) driver.vehicle = {};
  if (vehicleModel) driver.vehicle.model = vehicleModel;
  if (vehicleColor) driver.vehicle.color = vehicleColor;
  if (vehiclePlate) driver.vehicle.plate = vehiclePlate;
  if (vehicleType) driver.vehicle.type = vehicleType;
  if (typeof verified === 'boolean') driver.verified = verified;

  saveDataToDisk();
  io.emit('driver_updated', driver);
  res.json(driver);
});

// BLOQUEAR OU DESBLOQUEAR MOTORISTA
app.post('/api/drivers/:id/toggle-block', (req, res) => {
  const driver = drivers.find(d => String(d.id) === String(req.params.id));
  if (!driver) return res.status(404).json({ error: 'Motorista não encontrado' });

  driver.blocked = !driver.blocked;
  if (driver.blocked) driver.status = 'blocked';
  else driver.status = 'online';

  saveDataToDisk();
  io.emit('driver_updated', driver);
  res.json(driver);
});

// EXCLUIR MOTORISTA PERMANENTEMENTE
app.delete('/api/drivers/:id', (req, res) => {
  const index = drivers.findIndex(d => String(d.id) === String(req.params.id));
  if (index === -1) return res.status(404).json({ error: 'Motorista não encontrado' });

  const deleted = drivers.splice(index, 1)[0];
  saveDataToDisk();
  io.emit('driver_deleted', deleted);
  res.json({ message: 'Motorista excluído com sucesso', deleted });
});

app.post('/api/rides/estimate', (req, res) => {
  const { origin, destination } = req.body;
  if (!origin || !destination) return res.status(400).json({ error: 'Origem e destino são obrigatórios' });

  const distanceKm = calculateDistanceKm(origin.lat, origin.lng, destination.lat, destination.lng);
  const durationMinutes = Math.max(3, Math.round((distanceKm / 30) * 60));
  
  const rawFare = (systemConfig.basePrice + (distanceKm * systemConfig.pricePerKm) + (durationMinutes * systemConfig.pricePerMin)) * systemConfig.surgeFactor;

  const options = Object.keys(systemConfig.categories).map(catKey => {
    const cat = systemConfig.categories[catKey];
    const finalFare = Math.max(10.00, parseFloat((rawFare * cat.multiplier).toFixed(2)));
    return {
      categoryKey: catKey,
      name: cat.name,
      icon: cat.icon,
      price: finalFare,
      etaMinutes: durationMinutes + Math.floor(Math.random() * 3) + 2,
      distanceKm: parseFloat(distanceKm.toFixed(2))
    };
  });

  res.json({ distanceKm: parseFloat(distanceKm.toFixed(2)), durationMinutes, surgeFactor: systemConfig.surgeFactor, options });
});

app.get('/api/rides/pending', (req, res) => {
  const pending = rides.filter(r => r.status === 'SEARCHING');
  res.json(pending);
});

app.post('/api/rides/request', (req, res) => {
  const { passengerName, origin, destination, categoryKey, estimatedPrice, paymentMethod } = req.body;
  
  const ride = {
    id: `ride-${Date.now()}`,
    passengerName: passengerName || 'Cliente 99',
    origin: origin || { lat: -23.561684, lng: -46.655981, name: 'MASP - Av. Paulista' },
    destination: destination || { lat: -23.587416, lng: -46.657634, name: 'Parque Ibirapuera' },
    categoryKey: categoryKey || 'pop',
    price: estimatedPrice || 18.50,
    paymentMethod: paymentMethod || 'pix',
    status: 'SEARCHING',
    createdAt: new Date()
  };

  rides.push(ride);
  saveDataToDisk();
  io.emit('ride_created', ride);
  io.emit('NEW_RIDE_REQUESTED', ride);
  res.status(201).json(ride);
});

// SOLICITAR DEVOLUÇÃO DA ENCOMENDA PELO MOTORISTA (DESTINATÁRIO AUSENTE)
app.post('/api/rides/:id/return-request', (req, res) => {
  const ride = rides.find(r => String(r.id) === String(req.params.id));
  if (!ride) return res.status(404).json({ error: 'Corrida não encontrada' });

  ride.returnStatus = 'REQUESTED';
  ride.status = 'RETURN_REQUESTED';
  saveDataToDisk();
  io.emit('ride_updated', ride);
  io.emit('RETURN_RIDE_REQUESTED', ride);
  res.json({ message: 'Solicitação de devolução enviada ao Suporte 99!', ride });
});

// APROVAR DEVOLUÇÃO DA ENCOMENDA PELO SUPORTE (ADMIN)
app.post('/api/rides/:id/return-approve', (req, res) => {
  const ride = rides.find(r => String(r.id) === String(req.params.id));
  if (!ride) return res.status(404).json({ error: 'Corrida não encontrada' });

  ride.returnStatus = 'APPROVED_RETURN_IN_PROGRESS';
  ride.status = 'RETURN_IN_PROGRESS';
  saveDataToDisk();
  io.emit('ride_updated', ride);
  io.emit('RETURN_RIDE_APPROVED', ride);
  res.json({ message: 'Devolução aprovada pelo Suporte!', ride });
});

// CONFIRMAR DEVOLUÇÃO CONCLUÍDA PELO MOTORISTA (NOME E TELEFONE DO RECEBEDOR)
app.post('/api/rides/:id/return-complete', (req, res) => {
  const ride = rides.find(r => String(r.id) === String(req.params.id));
  if (!ride) return res.status(404).json({ error: 'Corrida não encontrada' });

  const { receiverName, receiverPhone } = req.body;
  ride.returnStatus = 'RETURNED_SUCCESS';
  ride.status = 'RETURNED_COMPLETED';
  ride.returnReceiverName = receiverName || 'Pessoa no local de origem';
  ride.returnReceiverPhone = receiverPhone || '(11) 98765-4321';
  ride.returnCompletedAt = new Date();

  saveDataToDisk();
  io.emit('ride_updated', ride);
  io.emit('RETURN_RIDE_COMPLETED', ride);
  res.json({ message: 'Devolução concluída e registrada com sucesso!', ride });
});

// WebSockets 99 Real-time
io.on('connection', (socket) => {
  console.log(`🔌 Novo cliente conectado via WebSocket: ${socket.id}`);

  socket.on('join_ride', (rideId) => socket.join(`ride_${rideId}`));

  socket.on('NEW_RIDE_REQUESTED', (ridePayload) => {
    console.log('📡 Transmitindo nova corrida para todos os motoristas:', ridePayload);
    io.emit('NEW_RIDE_REQUESTED', ridePayload);
  });

  socket.on('RIDE_ACCEPTED_FIRST_WINNER', (payload) => {
    console.log('📡 Transmitindo aceite de corrida:', payload);
    io.emit('RIDE_ACCEPTED_FIRST_WINNER', payload);
  });

  socket.on('update_driver_location', (data) => {
    const driver = drivers.find(d => d.id === data.driverId);
    if (driver) {
      driver.location = { lat: data.lat, lng: data.lng, heading: data.heading || 0 };
      io.emit('driver_location_updated', { driverId: driver.id, location: driver.location });
    }
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🟡 SERVIDOR 99 SUPER-APP ENGINE v3.0 RODANDO NA PORTA ${PORT}`);
  console.log(`📍 Endpoint REST: http://localhost:${PORT}/api/health`);
  console.log(`⚡ WebSocket Server: ws://localhost:${PORT}`);
  console.log(`====================================================`);
});
