const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('folio', {
  books: {
    list: () => ipcRenderer.invoke('books:list'),
    update: (book) => ipcRenderer.invoke('books:update', book),
    delete: (id) => ipcRenderer.invoke('books:delete', id),
    import: () => ipcRenderer.invoke('books:import'),
    importPaths: (paths) => ipcRenderer.invoke('books:import-paths', paths),
    findDuplicates: () => ipcRenderer.invoke('books:find-duplicates'),
    openFile: (id) => ipcRenderer.invoke('book:open-file', id),
    revealFile: (id) => ipcRenderer.invoke('book:reveal-file', id),
    openInKoreader: (id) => ipcRenderer.invoke('book:open-in-koreader', id)
  },
  devices: {
    list: () => ipcRenderer.invoke('devices:list'),
    update: (device) => ipcRenderer.invoke('devices:update', device),
    delete: (id) => ipcRenderer.invoke('devices:delete', id),
    add: (device) => ipcRenderer.invoke('devices:add', device),
    send: (bookIds, deviceId, folderOverride) => ipcRenderer.invoke('devices:send', { bookIds, deviceId, folderOverride }),
    listFolders: (deviceId, subpath) => ipcRenderer.invoke('devices:list-folders', { deviceId, subpath }),
    syncKoreader: (deviceId) => ipcRenderer.invoke('devices:sync-koreader', deviceId),
    scanBooks: (deviceId) => ipcRenderer.invoke('devices:scan-books', deviceId)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (data) => ipcRenderer.invoke('settings:set', data)
  },
  kindle: {
    sendEmail: (bookIds, deviceId) => ipcRenderer.invoke('kindle:send-email', { bookIds, deviceId })
  }
});
