"use strict";
/**
 * Electron Preload Script
 *
 * Executes in the renderer process before web content begins loading.
 * Exposes safe desktop utilities across the boundary.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// WHAT: Expose webUtils.getPathForFile onto the global window object.
// WHY: In Electron apps with native drag-and-drop, HTML5 File objects have their native .path property
// deprecated for web standards compatibility. Electron provides webUtils.getPathForFile() to retrieve
// the true underlying filesystem path safely.
window.electronWebUtils = {
    getPathForFile: (target_html5_file) => {
        return electron_1.webUtils.getPathForFile(target_html5_file);
    }
};
// WHAT: Populates version badge placeholders in the DOM upon completion of document loading.
// WHY: Provides immediate diagnostic feedback on the exact Chromium, Node, and Electron runtime versions.
window.addEventListener('DOMContentLoaded', () => {
    const replaceElementTextContent = (element_dom_selector, replacement_text_content) => {
        const target_dom_element = document.getElementById(element_dom_selector);
        if (target_dom_element) {
            target_dom_element.innerText = replacement_text_content;
        }
    };
    const runtime_dependencies_list = ['chrome', 'node', 'electron'];
    for (const runtime_dependency_name of runtime_dependencies_list) {
        const runtime_version_string = process.versions[runtime_dependency_name];
        if (runtime_version_string) {
            replaceElementTextContent(`${runtime_dependency_name}-version`, runtime_version_string);
        }
    }
});
