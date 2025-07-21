import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';

// Mock performance.now for consistent timing
let mockTime = 0;
const mockPerformanceNow = jest.fn(() => {
  mockTime += 16.67; // ~60fps
  return mockTime;
});
(global as any).performance = { now: mockPerformanceNow };

// Mock WebSocket as EventEmitter
class MockWebSocket extends EventEmitter {
  public send = jest.fn();
  public close = jest.fn();
  public readyState = 1;

  simulateMessage(message: string | Buffer) {
    this.emit('message', message);
  }

  simulateClose() {
    this.emit('close');
  }
}

describe('Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTime = 0;
  });

  describe('WebSocket to ScreenCaptureManager Integration', () => {
    test('should establish complete VNC connection workflow', async () => {
      const mockWs = new MockWebSocket();
      
      // Mock dependencies
      jest.doMock('vscode', () => ({}));
      jest.doMock('@hurdlegroup/robotjs', () => ({
        typedRobot: {
          getScreenSize: jest.fn(() => ({ width: 1920, height: 1080 })),
          moveMouse: jest.fn(),
          mouseToggle: jest.fn()
        }
      }));

      // Import websockets module after mocks
      const websocketsModule = require('../src/websockets');
      
      // Reset singleton for clean test
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      
      // Create VNC connection (this should also create ScreenCaptureManager)
      const vncConnection = new (websocketsModule as any).VSCodeVNCConnection(mockWs);
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Verify connection established
      expect(manager).toBeDefined();
      expect(vncConnection).toBeDefined();
      
      // Simulate frame capture and transmission
      const mockFrameBuffer = Buffer.from('mock-frame-data');
      const mockDimensions = { width: 1200, height: 675 };
      
      // Get the frame subscription callback
      const subscribers = (manager as any).subscribers;
      expect(subscribers.length).toBe(1);
      
      // Simulate frame transmission
      subscribers[0](mockFrameBuffer, mockDimensions);
      
      // Verify frame was sent via WebSocket
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'screen-update',
          image: mockFrameBuffer.toString('base64'),
          dimensions: mockDimensions
        })
      );
      
      // Clean up
      vncConnection.dispose();
    });

    test('should handle quality updates from client to ScreenCaptureManager', async () => {
      const mockWs = new MockWebSocket();
      
      jest.doMock('vscode', () => ({}));
      jest.doMock('@hurdlegroup/robotjs', () => ({
        typedRobot: {
          getScreenSize: jest.fn(() => ({ width: 1920, height: 1080 }))
        }
      }));

      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      
      const vncConnection = new (websocketsModule as any).VSCodeVNCConnection(mockWs);
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Get initial settings
      const initialSettings = manager.getQualitySettings();
      
      // Simulate quality update message from client
      const qualityUpdate = {
        type: 'quality-update',
        width: 1000,
        jpegQuality: 75,
        fps: 25
      };
      
      await mockWs.simulateMessage(Buffer.from(JSON.stringify(qualityUpdate)));
      
      // Verify settings were updated
      const updatedSettings = manager.getQualitySettings();
      expect(updatedSettings.width).toBe(1000);
      expect(updatedSettings.jpegQuality).toBe(75);
      expect(updatedSettings.fps).toBe(25);
      
      vncConnection.dispose();
    });

    test('should handle mouse events with coordinate transformation', async () => {
      const mockWs = new MockWebSocket();
      const mockRobot = {
        getScreenSize: jest.fn(() => ({ width: 1920, height: 1080 })),
        moveMouse: jest.fn(),
        mouseToggle: jest.fn()
      };
      
      jest.doMock('vscode', () => ({}));
      jest.doMock('@hurdlegroup/robotjs', () => ({
        typedRobot: mockRobot
      }));

      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      
      const vncConnection = new (websocketsModule as any).VSCodeVNCConnection(mockWs);
      
      // Simulate mouse event
      const mouseEvent = {
        type: 'mouse-event',
        x: 400,
        y: 300,
        eventType: 'down',
        screenWidth: 800,
        screenHeight: 600
      };
      
      await mockWs.simulateMessage(Buffer.from(JSON.stringify(mouseEvent)));
      
      // Verify coordinate transformation and robot interaction
      expect(mockRobot.moveMouse).toHaveBeenCalledWith(960, 540); // Scaled coordinates
      expect(mockRobot.mouseToggle).toHaveBeenCalledWith('down', 'left');
      
      vncConnection.dispose();
    });
  });

  describe('Server to WebSocket Integration', () => {
    test('should handle complete server lifecycle with WebSocket connections', async () => {
      // Mock HTTP server
      const mockHttpServer = new EventEmitter() as any;
      mockHttpServer.listen = jest.fn((port: number, address: string, callback: Function) => {
        setTimeout(callback, 10);
      });

      // Mock WebSocket Server
      const mockWebSocketServer = new EventEmitter() as any;
      mockWebSocketServer.close = jest.fn((callback?: Function) => {
        if (callback) callback();
      });

      jest.doMock('http', () => ({
        createServer: jest.fn(() => mockHttpServer)
      }));

      jest.doMock('ws', () => ({
        default: {
          Server: jest.fn(() => mockWebSocketServer)
        }
      }));

      jest.doMock('vscode', () => ({
        window: { showInformationMessage: jest.fn() }
      }));

      // Mock state management
      const mockStore = {
        getState: jest.fn(() => ({
          server: { isRunning: false, port: 3000 },
          websocket: { wss: null },
          webview: { panel: null }
        }))
      };

      const mockSetServerRunning = jest.fn();
      const mockSetWebSocketServer = jest.fn();

      jest.doMock('../src/state/store', () => ({ store: mockStore }));
      jest.doMock('../src/state/actions', () => ({
        setServerRunning: mockSetServerRunning,
        setWebSocketServer: mockSetWebSocketServer
      }));

      // Mock WebSocket connection handler
      const mockHandleWebSocketConnection = jest.fn();
      jest.doMock('../src/websockets', () => ({
        handleWebSocketConnection: mockHandleWebSocketConnection
      }));

      // Import server module after mocks
      const serverModule = await import('../src/server');
      
      // Start server
      await serverModule.startServer('localhost');
      
      // Verify server setup
      expect(mockSetServerRunning).toHaveBeenCalledWith(true);
      expect(mockSetWebSocketServer).toHaveBeenCalledWith(mockWebSocketServer);
      
      // Verify WebSocket server is configured with connection handler
      expect(mockWebSocketServer.on).toHaveBeenCalledWith(
        'connection',
        mockHandleWebSocketConnection
      );
      
      // Simulate WebSocket connection
      const mockConnection = new MockWebSocket();
      mockWebSocketServer.emit('connection', mockConnection);
      
      // Verify connection handler was called
      expect(mockHandleWebSocketConnection).toHaveBeenCalledWith(mockConnection);
      
      // Update mock state for stop
      mockStore.getState.mockReturnValue({
        server: { isRunning: true, port: 3000 },
        websocket: { wss: mockWebSocketServer },
        webview: { panel: null }
      });
      
      // Stop server
      serverModule.stopServer();
      
      // Verify cleanup
      expect(mockWebSocketServer.close).toHaveBeenCalled();
      expect(mockSetServerRunning).toHaveBeenCalledWith(false);
    });
  });

  describe('Command Handler Integration', () => {
    test('should integrate command handling with robot controls', async () => {
      // Mock all dependencies
      const mockVSCode = {
        commands: { executeCommand: jest.fn() },
        window: { 
          activeTextEditor: {
            selection: null,
            revealRange: jest.fn()
          }
        },
        Position: jest.fn((line: number, char: number) => ({ line, char })),
        Selection: jest.fn(),
        Range: jest.fn()
      };

      const mockRobotHandlers = {
        type: jest.fn(),
        search: jest.fn(),
        replace: jest.fn()
      };

      jest.doMock('vscode', () => mockVSCode);
      jest.doMock('../src/commanding/robotjs-handlers', () => ({
        RobotJSCommandHandlers: mockRobotHandlers
      }));
      jest.doMock('../src/commanding/commands', () => ({
        BuiltInCommands: { save: 'workbench.action.files.save' },
        Commands: { SAVE: 'save' }
      }));

      const mockWs = { send: jest.fn() };
      
      // Import command handler after mocks
      const commandHandlerModule = await import('../src/commanding/command-handler');
      
      // Test various command types
      await commandHandlerModule.handleCommand('save' as any, mockWs as any);
      expect(mockVSCode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.save');
      
      await commandHandlerModule.handleCommand('type hello world' as any, mockWs as any);
      expect(mockRobotHandlers.type).toHaveBeenCalledWith('hello world');
      
      await commandHandlerModule.handleCommand('search function' as any, mockWs as any);
      expect(mockRobotHandlers.search).toHaveBeenCalledWith('function');
      
      await commandHandlerModule.handleCommand('replace old with new' as any, mockWs as any);
      expect(mockRobotHandlers.replace).toHaveBeenCalledWith('old', 'new');
      
      await commandHandlerModule.handleCommand('go to line 42' as any, mockWs as any);
      expect(mockVSCode.Position).toHaveBeenCalledWith(41, 0);
    });
  });

  describe('End-to-End Resolution Detection', () => {
    test('should adapt settings based on different screen resolutions', () => {
      const resolutionConfigs = [
        { resolution: { width: 7680, height: 4320 }, expected: { profile: '8K+', width: 960, quality: 70, fps: 20 } },
        { resolution: { width: 5120, height: 2880 }, expected: { profile: '5K-6K', width: 1024, quality: 75, fps: 25 } },
        { resolution: { width: 3840, height: 2160 }, expected: { profile: '4K', width: 1200, quality: 80, fps: 30 } },
        { resolution: { width: 3440, height: 1440 }, expected: { profile: 'Ultrawide', width: 1280, quality: 82, fps: 35 } },
        { resolution: { width: 2560, height: 1440 }, expected: { profile: 'QHD', width: 1440, quality: 85, fps: 40 } },
        { resolution: { width: 1920, height: 1080 }, expected: { profile: 'FHD', width: 1440, quality: 85, fps: 45 } }
      ];

      resolutionConfigs.forEach(config => {
        jest.doMock('vscode', () => ({}));
        jest.doMock('@hurdlegroup/robotjs', () => ({
          typedRobot: {
            getScreenSize: jest.fn(() => config.resolution)
          }
        }));

        const websocketsModule = require('../src/websockets');
        (websocketsModule as any).ScreenCaptureManager.instance = null;
        
        const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
        const info = manager.getResolutionInfo();
        const settings = manager.getQualitySettings();
        
        expect(info.profile).toBe(config.expected.profile);
        expect(settings.width).toBe(config.expected.width);
        expect(settings.jpegQuality).toBe(config.expected.quality);
        expect(settings.fps).toBe(config.expected.fps);
        
        // Clean up for next iteration
        jest.resetModules();
      });
    });
  });

  describe('Memory Pressure Integration', () => {
    test('should coordinate memory pressure across all components', () => {
      jest.doMock('vscode', () => ({}));
      jest.doMock('@hurdlegroup/robotjs', () => ({
        typedRobot: {
          getScreenSize: jest.fn(() => ({ width: 3840, height: 2160 })) // 4K for memory pressure testing
        }
      }));

      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Simulate memory pressure
      const largeFrameSize = 600 * 1024 * 1024; // 600MB
      manager.updateMemoryUsage(largeFrameSize, true);
      
      // Verify memory pressure affects all systems
      const info = manager.getResolutionInfo();
      expect(info.memoryPressure).toBe(true);
      
      // Adaptive interval should increase under memory pressure
      const normalInterval = 50; // Base 4K interval
      const pressureInterval = (manager as any).calculateAdaptiveInterval();
      expect(pressureInterval).toBeGreaterThan(normalInterval * 1.4);
      
      // Quality adjustment should be more aggressive
      (manager as any).droppedFrames = 15;
      (manager as any).framesSent = 85;
      
      const initialQuality = manager.getQualitySettings().jpegQuality;
      (manager as any).adjustQualityIfNeeded();
      const adjustedQuality = manager.getQualitySettings().jpegQuality;
      
      expect(adjustedQuality).toBeLessThan(initialQuality); // Quality should be reduced
    });
  });

  describe('Chunked Frame Transmission Integration', () => {
    test('should handle large frame chunking end-to-end', async () => {
      const mockWs = new MockWebSocket();
      
      jest.doMock('vscode', () => ({}));
      jest.doMock('@hurdlegroup/robotjs', () => ({
        typedRobot: {
          getScreenSize: jest.fn(() => ({ width: 3840, height: 2160 })) // 4K
        }
      }));

      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      
      const vncConnection = new (websocketsModule as any).VSCodeVNCConnection(mockWs);
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Create large frame that exceeds chunking threshold
      const largeFrame = Buffer.alloc(2 * 1024 * 1024, 0x42); // 2MB frame
      const mockDimensions = { width: 1200, height: 675 };
      
      // Get current profile chunking threshold
      const info = manager.getResolutionInfo();
      expect(info.profile).toBe('4K');
      
      // Create chunked frame
      const chunkedFrame = (manager as any).createChunkedFrame(largeFrame);
      expect(chunkedFrame.chunks.length).toBeGreaterThan(1);
      
      // Simulate transmission of chunked frame
      const subscribers = (manager as any).subscribers;
      subscribers[0](chunkedFrame, mockDimensions);
      
      // Verify chunked transmission
      expect(mockWs.send).toHaveBeenCalledTimes(chunkedFrame.total);
      
      // Verify chunk structure
      for (let i = 0; i < chunkedFrame.total; i++) {
        expect(mockWs.send).toHaveBeenCalledWith(
          JSON.stringify({
            type: 'screen-update-chunk',
            chunk: chunkedFrame.chunks[i].toString('base64'),
            chunkIndex: i,
            totalChunks: chunkedFrame.total,
            dimensions: mockDimensions,
            isLastChunk: i === chunkedFrame.total - 1
          })
        );
      }
      
      vncConnection.dispose();
    });
  });

  describe('Error Recovery Integration', () => {
    test('should recover gracefully from component failures', async () => {
      const mockWs = new MockWebSocket();
      
      // Mock robot to occasionally throw errors
      const mockRobot = {
        getScreenSize: jest.fn(() => ({ width: 1920, height: 1080 })),
        moveMouse: jest.fn(),
        mouseToggle: jest.fn()
      };

      jest.doMock('vscode', () => ({}));
      jest.doMock('@hurdlegroup/robotjs', () => ({
        typedRobot: mockRobot
      }));

      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      
      const vncConnection = new (websocketsModule as any).VSCodeVNCConnection(mockWs);
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Simulate robot error
      mockRobot.moveMouse.mockImplementationOnce(() => {
        throw new Error('Robot error');
      });
      
      const mouseEvent = {
        type: 'mouse-event',
        x: 100,
        y: 100,
        eventType: 'move',
        screenWidth: 800,
        screenHeight: 600
      };
      
      // Should not crash the system
      await expect(
        mockWs.simulateMessage(Buffer.from(JSON.stringify(mouseEvent)))
      ).resolves.not.toThrow();
      
      // System should still be functional
      expect(manager.getResolutionInfo()).toBeDefined();
      expect(manager.getQualitySettings()).toBeDefined();
      
      // Next mouse event should work normally
      mockRobot.moveMouse.mockImplementation(() => {}); // Reset mock
      await mockWs.simulateMessage(Buffer.from(JSON.stringify(mouseEvent)));
      expect(mockRobot.moveMouse).toHaveBeenCalled();
      
      vncConnection.dispose();
    });
  });
});