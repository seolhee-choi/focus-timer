const { app, BrowserWindow, ipcMain, screen, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { io: createSocket } = require('socket.io-client');
const { createRoomServer } = require('./room-server.cjs');

let controllerWindow;
let petWindow;
let savePositionTimer;
let roomServer;
let roomSocket;
let currentRoom;
let localMember = {
  id: crypto.randomUUID(), character: 'hedgehog', nickname: '', task: '',
  remainingSeconds: 0, running: false, active: false,
};
const remotePetWindows = new Map();
let pendingInvite;

const PET_WIDTH = 230;
const PET_HEIGHT = 265;
const PET_MIN_WIDTH = 150;
const PET_MIN_HEIGHT = Math.round(PET_MIN_WIDTH * PET_HEIGHT / PET_WIDTH);
const PET_MAX_WIDTH = 420;
const PET_MAX_HEIGHT = Math.round(PET_MAX_WIDTH * PET_HEIGHT / PET_WIDTH);
const EDGE_GAP = 8;

function positionFile() {
  return path.join(app.getPath('userData'), 'pet-position.json');
}

function defaultPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - PET_WIDTH - EDGE_GAP,
    y: area.y + area.height - PET_HEIGHT - EDGE_GAP,
    width: PET_WIDTH,
    height: PET_HEIGHT,
  };
}

function readSavedPosition() {
  try {
    const saved = JSON.parse(fs.readFileSync(positionFile(), 'utf8'));
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const width = Math.max(PET_MIN_WIDTH, Math.min(PET_MAX_WIDTH, Number(saved.width) || PET_WIDTH));
      return { ...saved, width, height: Math.round(width * PET_HEIGHT / PET_WIDTH) };
    }
  } catch {}
  return defaultPosition();
}

function clampPosition(position, width = PET_WIDTH, height = PET_HEIGHT) {
  const display = screen.getDisplayNearestPoint(position);
  const area = display.workArea;
  return {
    x: Math.max(area.x, Math.min(position.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(position.y, area.y + area.height - height)),
  };
}

function savePetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const { x, y, width, height } = petWindow.getBounds();
  fs.writeFileSync(positionFile(), JSON.stringify({ x, y, width, height }), 'utf8');
}

function keepPetVisible() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const { x, y, width, height } = petWindow.getBounds();
  const safe = clampPosition({ x, y }, width, height);
  petWindow.setPosition(safe.x, safe.y, false);
  savePetPosition();
}

function createControllerWindow() {
  controllerWindow = new BrowserWindow({
    width: 390,
    height: 790,
    minWidth: 370,
    minHeight: 760,
    title: '포커스 펫 데스크톱 타이머',
    backgroundColor: '#fffaf2',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  controllerWindow.loadFile(path.join(__dirname, '..', 'index.html'));
  controllerWindow.on('closed', () => {
    controllerWindow = null;
  });
  return controllerWindow;
}

function showControllerWindow() {
  if (!controllerWindow || controllerWindow.isDestroyed()) createControllerWindow();
  if (controllerWindow.isMinimized()) controllerWindow.restore();
  controllerWindow.show();
  controllerWindow.focus();
}

function createPetWindow() {
  const saved = readSavedPosition();
  const position = clampPosition(saved, saved.width, saved.height);
  petWindow = new BrowserWindow({
    ...position,
    width: saved.width,
    height: saved.height,
    minWidth: PET_MIN_WIDTH,
    minHeight: PET_MIN_HEIGHT,
    maxWidth: PET_MAX_WIDTH,
    maxHeight: PET_MAX_HEIGHT,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    focusable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'pet-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setAspectRatio(PET_WIDTH / PET_HEIGHT);
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.loadFile(path.join(__dirname, 'pet.html'));

  petWindow.on('moved', () => {
    clearTimeout(savePositionTimer);
    savePositionTimer = setTimeout(() => {
      keepPetVisible();
    }, 180);
  });
  petWindow.on('resized', () => {
    clearTimeout(savePositionTimer);
    savePositionTimer = setTimeout(keepPetVisible, 180);
  });

  screen.on('display-metrics-changed', keepPetVisible);
  screen.on('display-added', keepPetVisible);
  screen.on('display-removed', keepPetVisible);
}

function localAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    const address = entries?.find(item => item.family === 'IPv4' && !item.internal);
    if (address) return address.address;
  }
  return '127.0.0.1';
}

function sendRoomStatus(value) {
  controllerWindow?.webContents.send('room:status', value);
}

function updateRoomPresence(patch) {
  localMember = { ...localMember, ...patch };
  if (roomSocket?.connected && currentRoom) roomSocket.emit('member:update', localMember);
}

function remotePosition(index) {
  const area = screen.getPrimaryDisplay().workArea;
  return clampPosition({
    x: area.x + area.width - PET_WIDTH - EDGE_GAP - ((index + 1) * 28),
    y: area.y + area.height - PET_HEIGHT - EDGE_GAP - ((index + 1) * 22),
  }, PET_WIDTH, PET_HEIGHT);
}

function syncRemotePets(members) {
  const remoteMembers = members.filter(member => member.id !== localMember.id && member.active);
  const activeIds = new Set(remoteMembers.map(member => member.id));
  for (const [id, window] of remotePetWindows) {
    if (!activeIds.has(id)) {
      window.destroy();
      remotePetWindows.delete(id);
    }
  }
  remoteMembers.forEach((member, index) => {
    let window = remotePetWindows.get(member.id);
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({
        ...remotePosition(index), width: PET_WIDTH, height: PET_HEIGHT, frame: false,
        transparent: true, resizable: false, movable: true, focusable: false,
        hasShadow: false, alwaysOnTop: true, skipTaskbar: true, show: false,
        webPreferences: { preload: path.join(__dirname, 'pet-preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
      });
      window.setAlwaysOnTop(true, 'screen-saver');
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      window.loadFile(path.join(__dirname, 'pet.html'), { query: { remote: '1' } });
      remotePetWindows.set(member.id, window);
      window.webContents.once('did-finish-load', () => renderRemotePet(window, member));
    } else {
      renderRemotePet(window, member);
    }
  });
}

function renderRemotePet(window, member) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('pet:character', member.character || 'hedgehog');
  window.webContents.send('pet:say', { nickname: member.nickname, task: member.task, fallback: '집중 중이에요.' });
  window.webContents.send('pet:state', member.running ? 'working' : 'resting');
  window.showInactive();
}

function parseInvite(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'focuspet:') return { room: url.searchParams.get('room'), server: url.searchParams.get('server') };
    const match = url.pathname.match(/^\/join\/([A-Z0-9]{6})$/i);
    if (match) return { room: match[1], server: url.origin };
  } catch {}
  return null;
}

function connectRoom(server, room) {
  roomSocket?.disconnect();
  currentRoom = room.toUpperCase();
  roomSocket = createSocket(server, { transports: ['websocket', 'polling'] });
  roomSocket.on('connect', () => {
    roomSocket.emit('room:join', { room: currentRoom, member: localMember });
    sendRoomStatus({ message: `방 ${currentRoom} · 연결됨` });
  });
  roomSocket.on('room:members', syncRemotePets);
  roomSocket.on('connect_error', () => sendRoomStatus({ message: '방에 연결할 수 없어요.' }));
}

function handleInviteUrl(value) {
  const invite = parseInvite(value);
  if (!invite?.room || !invite?.server) return false;
  if (!app.isReady()) {
    pendingInvite = value;
    return true;
  }
  connectRoom(invite.server, invite.room);
  showControllerWindow();
  return true;
}

function showPet(state, message) {
  if (!petWindow || petWindow.isDestroyed()) return;
  keepPetVisible();
  petWindow.showInactive();
  petWindow.webContents.send('pet:state', state);
  if (message) petWindow.webContents.send('pet:say', message);
}

ipcMain.handle('pet:start', (_event, payload) => {
  petWindow.webContents.send('pet:character', payload.character || 'hedgehog');
  const message = {
    nickname: payload.nickname?.trim() || '',
    task: payload.task?.trim() || '',
    fallback: '같이 집중하자!',
  };
  showPet('working', message);
  updateRoomPresence({ character: payload.character, nickname: payload.nickname, task: payload.task, active: true, running: true });
  controllerWindow?.minimize();
});

ipcMain.handle('pet:select-character', (_event, character) => {
  const allowed = ['hedgehog', 'cat', 'hamster', 'rabbit'];
  const selected = allowed.includes(character) ? character : 'hedgehog';
  petWindow?.webContents.send('pet:character', selected);
});

ipcMain.handle('pet:pause', () => {
  showPet('resting', '잠깐 쉬는 중...');
  updateRoomPresence({ running: false });
});

ipcMain.on('pet:update-timer', (_event, payload) => {
  petWindow?.webContents.send('pet:timer', payload);
  updateRoomPresence(payload);
});

ipcMain.handle('timer:toggle-request', () => {
  controllerWindow?.webContents.send('timer:toggle-from-widget');
});

ipcMain.handle('controller:show-request', () => {
  showControllerWindow();
});

ipcMain.handle('pet:reset', () => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide();
  }
  updateRoomPresence({ active: false, running: false });
});

ipcMain.handle('pet:complete', () => {
  showPet('complete', '타이머가 종료되었습니다.');
  petWindow.setFocusable(true);
  petWindow.show();
  petWindow.focus();
  if (Notification.isSupported()) {
    new Notification({ title: '집중 완료!', body: '설정한 집중 시간이 끝났어요.' }).show();
  }
});

ipcMain.handle('timer:add-request', (_event, value) => {
  const minutes = Math.max(1, Math.min(180, Number(value) || 1));
  showPet('working', `${minutes}분 더 같이 집중하자!`);
  controllerWindow?.webContents.send('timer:add', minutes);
});

ipcMain.handle('timer:end-request', () => {
  petWindow.hide();
  updateRoomPresence({ active: false, running: false });
  controllerWindow?.webContents.send('timer:end');
});

ipcMain.handle('room:create', async (_event, profile) => {
  const configuredServer = process.env.FOCUS_PET_SERVER_URL?.replace(/\/$/, '');
  if (!configuredServer && !roomServer) roomServer = await createRoomServer(4317);
  const room = crypto.randomBytes(3).toString('hex').toUpperCase();
  const server = configuredServer || `http://${localAddress()}:4317`;
  localMember = { ...localMember, ...profile };
  connectRoom(server, room);
  const inviteUrl = `${server}/join/${room}`;
  sendRoomStatus({ message: `방 ${room} · 방장`, inviteUrl });
  return { room, inviteUrl };
});

ipcMain.handle('room:join', (_event, value) => {
  const invite = parseInvite(value);
  if (!invite?.room || !invite?.server) {
    sendRoomStatus({ message: '올바른 초대 링크가 아니에요.' });
    return false;
  }
  connectRoom(invite.server, invite.room);
  return true;
});

app.whenReady().then(() => {
  createControllerWindow();
  createPetWindow();
  if (pendingInvite) handleInviteUrl(pendingInvite);
  app.on('activate', () => {
    showControllerWindow();
    if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  });
});

if (process.platform === 'win32') {
  if (app.isPackaged) app.setAsDefaultProtocolClient('focuspet');
  else app.setAsDefaultProtocolClient('focuspet', process.execPath, [path.resolve(process.argv[1] || '.')]);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const inviteUrl = argv.find(value => value.startsWith('focuspet://'));
    if (inviteUrl) handleInviteUrl(inviteUrl);
    else showControllerWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
