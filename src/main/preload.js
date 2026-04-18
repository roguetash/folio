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
    scanBooks: (deviceId) => ipcRenderer.invoke('devices:scan-books', deviceId),
    listBooks: (deviceId) => ipcRenderer.invoke('devices:list-books', deviceId),
    removeBook: (deviceId, devicePath) => ipcRenderer.invoke('devices:remove-book', { deviceId, devicePath }),
    importFromDevice: (devicePath) => ipcRenderer.invoke('devices:import-from-device', devicePath),
    exportBooks: (devicePaths) => ipcRenderer.invoke('devices:export-books', devicePaths),
    createFolder: (deviceId, parentPath, name) => ipcRenderer.invoke('devices:create-folder', { deviceId, parentPath, name }),
    renameFolder: (deviceId, folderPath, newName) => ipcRenderer.invoke('devices:rename-folder', { deviceId, folderPath, newName }),
    deleteFolder: (deviceId, folderPath) => ipcRenderer.invoke('devices:delete-folder', { deviceId, folderPath }),
    moveBooks: (deviceId, devicePaths, destFolder) => ipcRenderer.invoke('devices:move-books', { deviceId, devicePaths, destFolder }),
    listAllFolders: (deviceId) => ipcRenderer.invoke('devices:list-all-folders', deviceId)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (data) => ipcRenderer.invoke('settings:set', data)
  },
  kindle: {
    sendEmail: (bookIds, deviceId) => ipcRenderer.invoke('kindle:send-email', { bookIds, deviceId })
  }
});
