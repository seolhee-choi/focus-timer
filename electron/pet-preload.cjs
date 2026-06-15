const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petView', {
  onDirection: callback => ipcRenderer.on('pet:direction', (_event, value) => callback(value)),
  onState: callback => ipcRenderer.on('pet:state', (_event, value) => callback(value)),
  onSay: callback => ipcRenderer.on('pet:say', (_event, value) => callback(value)),
  onCharacter: callback => ipcRenderer.on('pet:character', (_event, value) => callback(value)),
  onTimer: callback => ipcRenderer.on('pet:timer', (_event, value) => callback(value)),
  addTime: minutes => ipcRenderer.invoke('timer:add-request', minutes),
  endTimer: () => ipcRenderer.invoke('timer:end-request'),
  toggleTimer: () => ipcRenderer.invoke('timer:toggle-request'),
  showController: () => ipcRenderer.invoke('controller:show-request'),
});
