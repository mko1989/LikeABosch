// Preload bridge (CommonJS: required for sandboxed preloads). Exposes a minimal, explicit API.
const { contextBridge, ipcRenderer } = require('electron');

const on = channel => callback => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
};

contextBridge.exposeInMainWorld('launcher', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings, password, bridgeToken) => ipcRenderer.invoke('settings:save', { settings, password, bridgeToken }),
  startServer: () => ipcRenderer.invoke('server:start'),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  serverStatus: () => ipcRenderer.invoke('server:status'),
  launchGui: () => ipcRenderer.invoke('gui:launch'),
  bridgesStatus: () => ipcRenderer.invoke('bridges:status'),
  onBridges: on('bridges:state'),
  onServerState: on('server:state'),
  onLog: on('server:log'),
  onDicentisStatus: on('dicentis:status'),
});
