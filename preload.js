/**
 * Preload da janela host — executado em contexto isolado antes do renderer.
 * Expõe via contextBridge APENAS o que a UI do browser precisa.
 * Nunca expõe ipcRenderer completo ou Node APIs diretamente.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  /** URL inicial (home page). */
  getHomePage: () => ipcRenderer.invoke('get-home-page'),

  // ── Histórico ──────────────────────────────────────────────────────────
  history: {
    add: (url, title) => ipcRenderer.send('history:add', { url, title }),
    list: (limit) => ipcRenderer.invoke('history:list', limit),
    search: (q) => ipcRenderer.invoke('history:search', q),
    clear: () => ipcRenderer.invoke('history:clear'),
    remove: (url) => ipcRenderer.invoke('history:remove', url),
  },

  // ── Favoritos ──────────────────────────────────────────────────────────
  bookmarks: {
    list: () => ipcRenderer.invoke('bookmarks:list'),
    has: (url) => ipcRenderer.invoke('bookmarks:has', url),
    toggle: (url, title) => ipcRenderer.invoke('bookmarks:toggle', { url, title }),
    remove: (url) => ipcRenderer.invoke('bookmarks:remove', url),
  },

  // ── Controles da janela (frameless) ─────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (callback) =>
      ipcRenderer.on('window:maximized', (_e, isMax) => callback(isMax)),
  },

  /**
   * Recebe ações de menu/atalho vindas do main process.
   * @param {(action: string, ...args: any[]) => void} callback
   */
  onMenuAction: (callback) =>
    ipcRenderer.on('menu', (_e, action, ...args) => callback(action, ...args)),
});
