const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('folio', {
  books: {
    list: () => ipcRenderer.invoke('books:list'),
    update: (book) => ipcRenderer.invoke('books:update', book),
    delete: (id) => ipcRenderer.invoke('books:delete', id),
    import: () => ipcRenderer.invoke('books:import'),
    importPaths: (paths) => ipcRenderer.invoke('books:import-paths', paths),
    openFile: (id) => ipcRenderer.invoke('book:open-file', id),
    revealFile: (id) => ipcRenderer.invoke('book:reveal-file', id),
    openInKoreader: (id) => ipcRenderer.invoke('book:open-in-koreader', id)
  },
  devices: {
    list: () => ipcRenderer.invoke('devices:list'),
    update: (device) => ipcRenderer.invoke('devices:update', device),
    send: (bookIds, deviceId) => ipcRenderer.invoke('devices:send', { bookIds, deviceId })
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (data) => ipcRenderer.invoke('settings:set', data)
  },
  kindle: {
    sendEmail: (bookIds, deviceId) => ipcRenderer.invoke('kindle:send-email', { bookIds, deviceId })
  }
});
