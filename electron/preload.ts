// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { webUtils, contextBridge } from 'electron';

// Safe API exposure for non-context-isolated worlds (contextIsolation: false)
// Use direct assignment instead of contextBridge which requires contextIsolation: true
(window as any).electronWebUtils = {
  getPathForFile: (file: File) => webUtils.getPathForFile(file)
};

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector: string, text: string) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type} -version`, (process.versions as Record<string, string>)[type]);
  }
});
