import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';

// Mock http module
const mockHttpServer = new EventEmitter() as any;
mockHttpServer.listen = jest.fn((port: number, address: string, callback: Function) => {
  // Simulate successful server start
  setTimeout(() => callback(), 10);
});

jest.mock('http', () => ({
  createServer: jest.fn(() => mockHttpServer)
}));

// Mock WebSocket Server
const mockWebSocketServer = new EventEmitter() as any;
mockWebSocketServer.close = jest.fn((callback?: Function) => {
  if (callback) callback();
});

jest.mock('ws', () => ({
  default: {
    Server: jest.fn(() => mockWebSocketServer)
  }
}));

// Mock vscode API
const mockVSCode = {
  window: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn()
  }
};

jest.mock('vscode', () => mockVSCode);

// Mock websockets module
jest.mock('../src/websockets', () => ({
  handleWebSocketConnection: jest.fn()
}));

// Mock state management
const mockStore = {
  getState: jest.fn(() => ({
    server: {
      isRunning: false,
      port: 3000
    },
    websocket: {
      wss: null
    },
    webview: {
      panel: null
    }
  }))
};

const mockSetServerRunning = jest.fn();
const mockSetWebSocketServer = jest.fn();

jest.mock('../src/state/store', () => ({
  store: mockStore
}));

jest.mock('../src/state/actions', () => ({
  setServerRunning: mockSetServerRunning,
  setWebSocketServer: mockSetWebSocketServer
}));

describe('Server', () => {
  let startServer: any;
  let stopServer: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Reset mock store state
    mockStore.getState.mockReturnValue({
      server: {
        isRunning: false,
        port: 3000
      },
      websocket: {
        wss: null
      },
      webview: {
        panel: null
      }
    });

    // Import server module after setting up mocks
    const serverModule = await import('../src/server');
    startServer = serverModule.startServer;
    stopServer = serverModule.stopServer;
  });

  afterEach(() => {
    // Clean up any running servers
    mockHttpServer.removeAllListeners();
    mockWebSocketServer.removeAllListeners();
  });

  describe('startServer', () => {
    test('should start server successfully on specified address and port', async () => {
      const address = '0.0.0.0';
      
      await startServer(address);

      expect(mockHttpServer.listen).toHaveBeenCalledWith(
        3000,
        address,
        expect.any(Function)
      );

      expect(mockSetServerRunning).toHaveBeenCalledWith(true);
      expect(mockSetWebSocketServer).toHaveBeenCalledWith(mockWebSocketServer);
      
      expect(mockVSCode.window.showInformationMessage).toHaveBeenCalledWith(
        'AirCodum server started at http://localhost:3000'
      );
    });

    test('should not start server if already running', async () => {
      mockStore.getState.mockReturnValue({
        server: {
          isRunning: true,
          port: 3000
        },
        websocket: { wss: null },
        webview: { panel: null }
      });

      await startServer('localhost');

      expect(mockHttpServer.listen).not.toHaveBeenCalled();
      expect(mockVSCode.window.showInformationMessage).toHaveBeenCalledWith(
        'AirCodum server is already running.'
      );
    });

    test('should set up WebSocket connection handler', async () => {
      const { handleWebSocketConnection } = require('../src/websockets');
      
      await startServer('localhost');

      expect(mockWebSocketServer.on).toHaveBeenCalledWith(
        'connection',
        handleWebSocketConnection
      );
    });

    test('should handle server startup errors', async () => {
      const testError = new Error('Port already in use');
      
      // Mock listen to call error handler
      mockHttpServer.listen = jest.fn((port: number, address: string, callback: Function) => {
        setTimeout(() => mockHttpServer.emit('error', testError), 10);
      });

      await expect(startServer('localhost')).rejects.toThrow('Port already in use');
      
      expect(mockSetServerRunning).not.toHaveBeenCalled();
      expect(mockSetWebSocketServer).not.toHaveBeenCalled();
    });

    test('should log server start message', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await startServer('192.168.1.100');

      expect(consoleSpy).toHaveBeenCalledWith(
        'AirCodum server started at http://192.168.1.100:3000'
      );
      
      consoleSpy.mockRestore();
    });

    test('should handle different port configurations', async () => {
      mockStore.getState.mockReturnValue({
        server: {
          isRunning: false,
          port: 8080
        },
        websocket: { wss: null },
        webview: { panel: null }
      });

      await startServer('localhost');

      expect(mockHttpServer.listen).toHaveBeenCalledWith(
        8080,
        'localhost',
        expect.any(Function)
      );

      expect(mockVSCode.window.showInformationMessage).toHaveBeenCalledWith(
        'AirCodum server started at http://localhost:8080'
      );
    });
  });

  describe('stopServer', () => {
    test('should stop WebSocket server when running', () => {
      const mockWss = {
        close: jest.fn((callback: Function) => callback())
      };

      mockStore.getState.mockReturnValue({
        server: { isRunning: true, port: 3000 },
        websocket: { wss: mockWss },
        webview: { panel: null }
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      stopServer();

      expect(mockWss.close).toHaveBeenCalled();
      expect(mockSetWebSocketServer).toHaveBeenCalledWith(null);
      expect(mockSetServerRunning).toHaveBeenCalledWith(false);
      expect(consoleSpy).toHaveBeenCalledWith('WebSocket server closed.');
      
      consoleSpy.mockRestore();
    });

    test('should dispose webview panel if exists', () => {
      const mockPanel = {
        dispose: jest.fn()
      };

      mockStore.getState.mockReturnValue({
        server: { isRunning: true, port: 3000 },
        websocket: { wss: null },
        webview: { panel: mockPanel }
      });

      stopServer();

      expect(mockPanel.dispose).toHaveBeenCalled();
      expect(mockSetServerRunning).toHaveBeenCalledWith(false);
    });

    test('should handle stopping server when no WebSocket server exists', () => {
      mockStore.getState.mockReturnValue({
        server: { isRunning: false, port: 3000 },
        websocket: { wss: null },
        webview: { panel: null }
      });

      // Should not throw error
      expect(() => stopServer()).not.toThrow();
      
      expect(mockSetServerRunning).toHaveBeenCalledWith(false);
      expect(mockSetWebSocketServer).toHaveBeenCalledWith(null);
    });

    test('should handle stopping server when no webview panel exists', () => {
      const mockWss = {
        close: jest.fn((callback: Function) => callback())
      };

      mockStore.getState.mockReturnValue({
        server: { isRunning: true, port: 3000 },
        websocket: { wss: mockWss },
        webview: { panel: null }
      });

      // Should not throw error
      expect(() => stopServer()).not.toThrow();
      
      expect(mockWss.close).toHaveBeenCalled();
      expect(mockSetServerRunning).toHaveBeenCalledWith(false);
    });

    test('should clean up all resources properly', () => {
      const mockWss = {
        close: jest.fn((callback: Function) => callback())
      };
      const mockPanel = {
        dispose: jest.fn()
      };

      mockStore.getState.mockReturnValue({
        server: { isRunning: true, port: 3000 },
        websocket: { wss: mockWss },
        webview: { panel: mockPanel }
      });

      stopServer();

      // Verify all cleanup actions were called
      expect(mockWss.close).toHaveBeenCalled();
      expect(mockSetWebSocketServer).toHaveBeenCalledWith(null);
      expect(mockSetServerRunning).toHaveBeenCalledWith(false);
      expect(mockPanel.dispose).toHaveBeenCalled();
    });
  });

  describe('Server Integration', () => {
    test('should create HTTP server and WebSocket server correctly', async () => {
      const http = require('http');
      const WebSocketModule = require('ws');

      await startServer('localhost');

      expect(http.createServer).toHaveBeenCalled();
      expect(WebSocketModule.default.Server).toHaveBeenCalledWith({ 
        server: mockHttpServer 
      });
    });

    test('should handle concurrent server operations', async () => {
      // Start server
      await startServer('localhost');
      expect(mockSetServerRunning).toHaveBeenCalledWith(true);

      // Try to start again (should be prevented)
      mockStore.getState.mockReturnValue({
        server: { isRunning: true, port: 3000 },
        websocket: { wss: mockWebSocketServer },
        webview: { panel: null }
      });

      await startServer('localhost');
      
      // Should show already running message
      expect(mockVSCode.window.showInformationMessage).toHaveBeenLastCalledWith(
        'AirCodum server is already running.'
      );
    });

    test('should properly sequence server lifecycle events', async () => {
      const callOrder: string[] = [];

      mockSetServerRunning.mockImplementation(() => {
        callOrder.push('setServerRunning');
      });

      mockSetWebSocketServer.mockImplementation(() => {
        callOrder.push('setWebSocketServer');
      });

      const originalListen = mockHttpServer.listen;
      mockHttpServer.listen = jest.fn((port, address, callback) => {
        callOrder.push('httpServerListen');
        originalListen.call(mockHttpServer, port, address, callback);
      });

      await startServer('localhost');

      expect(callOrder).toEqual([
        'httpServerListen',
        'setServerRunning',
        'setWebSocketServer'
      ]);
    });
  });

  describe('Error Scenarios', () => {
    test('should handle WebSocket server close errors gracefully', () => {
      const mockWss = {
        close: jest.fn((callback: Function) => {
          // Simulate error during close
          throw new Error('Close error');
        })
      };

      mockStore.getState.mockReturnValue({
        server: { isRunning: true, port: 3000 },
        websocket: { wss: mockWss },
        webview: { panel: null }
      });

      // Should not throw despite WebSocket close error
      expect(() => stopServer()).not.toThrow();
      expect(mockSetServerRunning).toHaveBeenCalledWith(false);
    });

    test('should handle webview panel dispose errors gracefully', () => {
      const mockPanel = {
        dispose: jest.fn(() => {
          throw new Error('Dispose error');
        })
      };

      mockStore.getState.mockReturnValue({
        server: { isRunning: false, port: 3000 },
        websocket: { wss: null },
        webview: { panel: mockPanel }
      });

      // Should not throw despite panel dispose error
      expect(() => stopServer()).not.toThrow();
      expect(mockSetServerRunning).toHaveBeenCalledWith(false);
    });
  });
});