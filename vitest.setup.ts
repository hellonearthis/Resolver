import '@testing-library/jest-dom/vitest';
import './src/polyfills';

// WHAT: JSDOM Canvas 2D measurement mock for @chenglou/pretext typography engine.
// WHY: In Node test environments, JSDOM does not ship native 2D canvas measurement.
if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = (() => ({
        font: '',
        measureText: (text: string) => ({
            width: (text || '').length * 8,
            actualBoundingBoxAscent: 12,
            actualBoundingBoxDescent: 4
        }),
        fillRect: () => {},
        clearRect: () => {},
        getImageData: () => ({ data: new Array(4) }),
        putImageData: () => {},
        createImageData: () => [],
        setTransform: () => {},
        drawImage: () => {},
        save: () => {},
        fillText: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        stroke: () => {},
        translate: () => {},
        scale: () => {},
        rotate: () => {},
        arc: () => {},
        fill: () => {},
        strokeRect: () => {}
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
