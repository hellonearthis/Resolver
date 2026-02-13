// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { webUtils, contextBridge } from 'electron';

// Explicitly expose webUtils to window for reliable access in renderer
// Explicitly expose webUtils to window for reliable access in renderer
try {
  (window as any).electronWebUtils = {
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  };
  console.log('Preload: webUtils exposed via direct assignment');
} catch (err) {
  console.error('Preload: Failed to expose webUtils', err);
}

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector: string, text: string) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type} -version`, (process.versions as Record<string, string>)[type]);
  }
});
