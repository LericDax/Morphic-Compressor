const { contextBridge, ipcRenderer } = require('electron');

const api = {
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickOutputDir: () => ipcRenderer.invoke('pick-output-dir'),
  pickWorkDir: () => ipcRenderer.invoke('pick-work-dir'),

  getPref: (key, fallback = null) => ipcRenderer.invoke('get-pref', key, fallback),
  setPref: (key, value) => ipcRenderer.invoke('set-pref', key, value),
  startMerge: (jobs) => ipcRenderer.invoke('start-merge', jobs),
  isMerging: () => ipcRenderer.invoke('is-merging'),
  clearWorkDir: () => ipcRenderer.invoke('clear-work-dir'),

  onMergeLog: (callback) => {
    ipcRenderer.on('merge-log', (_event, payload) => callback(payload));
  },
  onMergeStatus: (callback) => {
    ipcRenderer.on('merge-status', (_event, payload) => callback(payload));
  },
};

contextBridge.exposeInMainWorld('glbMerger', api);
