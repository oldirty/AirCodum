// Global test setup and mocks
import { jest } from '@jest/globals';

// Mock VS Code API
const mockVSCode = {
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn()
    }))
  },
  window: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn()
  },
  commands: {
    registerCommand: jest.fn(),
    executeCommand: jest.fn()
  },
  ExtensionContext: jest.fn(),
  WebviewPanel: jest.fn(),
  Uri: {
    file: jest.fn(),
    parse: jest.fn()
  }
};

// Mock screenshot-desktop
jest.mock('screenshot-desktop', () => {
  return jest.fn().mockImplementation(() => {
    // Return a mock Buffer representing a screen capture
    return Promise.resolve(Buffer.from('mock-screenshot-data'));
  });
});

// Mock robotjs
jest.mock('@hurdlegroup/robotjs', () => ({
  typedRobot: {
    getScreenSize: jest.fn(() => ({ width: 1920, height: 1080 })),
    moveMouse: jest.fn(),
    mouseToggle: jest.fn(),
    keyTap: jest.fn()
  }
}));

// Mock WebSocket
const mockWebSocket = {
  send: jest.fn(),
  on: jest.fn(),
  close: jest.fn(),
  readyState: 1
};
jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => mockWebSocket);
});

// Mock jimp
jest.mock('../src/jimp', () => ({
  createImage: jest.fn().mockImplementation(() => ({
    width: 1920,
    height: 1080,
    resize: jest.fn().mockReturnThis(),
    getBuffer: jest.fn().mockImplementation((format, options) => {
      // Return mock compressed image data
      const mockSize = Math.floor(100000 * (options.quality / 100));
      return Buffer.alloc(mockSize, 0);
    })
  }))
}));

// Mock crypto
jest.mock('crypto', () => ({
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => 'mock-hash-12345')
  }))
}));

// Mock node-fetch
jest.mock('node-fetch', () => ({
  default: jest.fn()
}));

// Mock fs-extra
jest.mock('fs-extra', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  ensureDir: jest.fn(),
  pathExists: jest.fn(() => Promise.resolve(true))
}));

// Make mocks available globally for tests
(global as any).mockVSCode = mockVSCode;
(global as any).mockWebSocket = mockWebSocket;

// Performance.now mock for consistent timing
const mockPerformanceNow = jest.fn();
let mockTime = 0;
mockPerformanceNow.mockImplementation(() => {
  mockTime += 16.67; // ~60fps
  return mockTime;
});
(global as any).performance = { now: mockPerformanceNow };

// Console methods for clean test output
console.debug = jest.fn();
console.log = jest.fn();
console.warn = jest.fn();
console.error = jest.fn();