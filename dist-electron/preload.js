"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
const electron_1 = require("electron");
// Explicitly expose webUtils to window for reliable access in renderer
// Explicitly expose webUtils to window for reliable access in renderer
try {
    window.electronWebUtils = {
        getPathForFile: (file) => electron_1.webUtils.getPathForFile(file)
    };
    console.log('Preload: webUtils exposed via direct assignment');
}
catch (err) {
    console.error('Preload: Failed to expose webUtils', err);
}
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
