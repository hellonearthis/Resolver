"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
const electron_1 = require("electron");
// Safe API exposure for non-context-isolated worlds (contextIsolation: false)
// Use direct assignment instead of contextBridge which requires contextIsolation: true
window.electronWebUtils = {
    getPathForFile: (file) => electron_1.webUtils.getPathForFile(file)
};
window.addEventListener('DOMContentLoaded', () => {
    const replaceText = (selector, text) => {
        const element = document.getElementById(selector);
        if (element)
            element.innerText = text;
    };
    for (const type of ['chrome', 'node', 'electron']) {
        replaceText(`${type} -version`, process.versions[type]);
    }
});
