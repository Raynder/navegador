/**
 * Preload do diálogo de seleção de certificado.
 * Expõe apenas o necessário para a janela de certificados.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('certAPI', {
  /** Recebe a lista de certificados e URL do main process */
  onCertList: (callback) => ipcRenderer.on('cert-list', (_e, data) => callback(data)),

  /** Envia o índice do certificado selecionado de volta ao main */
  selectCert: (index) => ipcRenderer.send('cert-selected', index),

  /** Cancela a seleção */
  cancel: () => ipcRenderer.send('cert-cancelled'),
});
