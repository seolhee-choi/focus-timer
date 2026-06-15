const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('godori', {
  start: payload => ipcRenderer.invoke('pet:start', payload),
  pause: () => ipcRenderer.invoke('pet:pause'),
  reset: () => ipcRenderer.invoke('pet:reset'),
  complete: () => ipcRenderer.invoke('pet:complete'),
  selectCharacter: character => ipcRenderer.invoke('pet:select-character', character),
  updateTimer: payload => ipcRenderer.send('pet:update-timer', payload),
  onAddTime: callback => ipcRenderer.on('timer:add', (_event, minutes) => callback(minutes)),
  onEndTimer: callback => ipcRenderer.on('timer:end', () => callback()),
  onWidgetToggle: callback => ipcRenderer.on('timer:toggle-from-widget', () => callback()),
  createRoom: profile => ipcRenderer.invoke('room:create', profile),
  joinRoom: value => ipcRenderer.invoke('room:join', value),
  onRoomStatus: callback => ipcRenderer.on('room:status', (_event, value) => callback(value)),
});
