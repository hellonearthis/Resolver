/**
 * src/electron-window.d.ts
 *
 * WHAT:
 *   Global augmentation for the DOM Window interface in the Electron desktop environment.
 *
 * WHY:
 *   Electron desktop renderer scripts access Node.js and Electron APIs via window.require
 *   and window.electronWebUtils when nodeIntegration is enabled or injected via preload.
 */

export {};

declare global {
  interface Window {
    require?: (moduleName: string) => any;
    electronWebUtils?: {
      getPathForFile?: (file: File) => string;
    };
  }
}
