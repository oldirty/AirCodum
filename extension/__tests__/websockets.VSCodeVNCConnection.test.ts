import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';

// Mock vscode module
jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn()
    }))
  },
  window: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn()
  }
}));

// Mock WebSocket as EventEmitter for testing
class MockWebSocket extends EventEmitter {
  public send = jest.fn();
  public close = jest.fn();
  public readyState = 1;

  constructor() {
    super();
  }

  simulateMessage(message: string | Buffer) {
    this.emit('message', message);
  }

  simulateClose() {
    this.emit('close');
  }
}

describe('VSCodeVNCConnection', () => {
  let mockWs: MockWebSocket;
  let vncConnection: any;

  // Mock robot for coordinate testing
  const mockRobot = {
    getScreenSize: jest.fn(() => ({ width: 1920, height: 1080 })),
    moveMouse: jest.fn(),
    mouseToggle: jest.fn(),
    keyTap: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWs = new MockWebSocket();
    
    // Mock the robotjs module
    jest.doMock('@hurdlegroup/robotjs', () => ({
      typedRobot: mockRobot
    }));

    // Import websockets module after setting up mocks
    const websocketsModule = require('../src/websockets');
    
    // Create VNC connection instance
    vncConnection = new (websocketsModule as any).VSCodeVNCConnection(mockWs);
  });

  afterEach(() => {
    if (vncConnection && vncConnection.dispose) {
      vncConnection.dispose();
    }
  });

  describe('WebSocket Message Handling', () => {
    test('should handle JSON mouse events', async () => {
      const mouseEvent = {
        type: 'mouse-event',
        x: 100,
        y: 50,
        eventType: 'down',
        screenWidth: 800,
        screenHeight: 600
      };

      await mockWs.simulateMessage(Buffer.from(JSON.stringify(mouseEvent)));

      // Verify mouse was moved to scaled coordinates
      const expectedX = Math.floor((100 / 800) * 1920); // Scale to actual screen
      const expectedY = Math.floor((50 / 600) * 1080);
      
      expect(mockRobot.moveMouse).toHaveBeenCalledWith(expectedX, expectedY);
      expect(mockRobot.mouseToggle).toHaveBeenCalledWith('down', 'left');
    });

    test('should handle JSON keyboard events', async () => {
      const keyboardEvent = {
        type: 'keyboard-event',
        key: 'a',
        modifier: 'ctrl'
      };

      await mockWs.simulateMessage(Buffer.from(JSON.stringify(keyboardEvent)));

      expect(mockRobot.keyTap).toHaveBeenCalledWith('a', 'ctrl');
    });

    test('should handle keyboard events without modifiers', async () => {
      const keyboardEvent = {
        type: 'keyboard-event',
        key: 'space'
      };

      await mockWs.simulateMessage(Buffer.from(JSON.stringify(keyboardEvent)));

      expect(mockRobot.keyTap).toHaveBeenCalledWith('space');
    });

    test('should handle quality update messages', async () => {
      const qualityUpdate = {
        type: 'quality-update',
        width: 1200,
        jpegQuality: 75,
        fps: 30
      };

      // Mock ScreenCaptureManager
      const mockManager = {
        updateQualitySettings: jest.fn()
      };
      
      jest.doMock('../src/websockets', () => ({
        ScreenCaptureManager: {
          getInstance: () => mockManager
        }
      }));

      await mockWs.simulateMessage(Buffer.from(JSON.stringify(qualityUpdate)));

      expect(mockManager.updateQualitySettings).toHaveBeenCalledWith(qualityUpdate);
    });
  });

  describe('Mouse Coordinate Mapping', () => {
    test('should correctly scale mouse coordinates from client to screen', async () => {
      const testCases = [
        // [clientX, clientY, clientWidth, clientHeight, expectedX, expectedY]
        [400, 300, 800, 600, 960, 540],  // Center of screen
        [0, 0, 800, 600, 0, 0],          // Top-left corner
        [800, 600, 800, 600, 1920, 1080], // Bottom-right corner
        [200, 150, 1600, 900, 240, 180]   // Different client resolution
      ];

      for (const [clientX, clientY, clientWidth, clientHeight, expectedX, expectedY] of testCases) {
        mockRobot.moveMouse.mockClear();
        
        const mouseEvent = {
          type: 'mouse-event',
          x: clientX,
          y: clientY,
          eventType: 'move',
          screenWidth: clientWidth,
          screenHeight: clientHeight
        };

        await mockWs.simulateMessage(Buffer.from(JSON.stringify(mouseEvent)));

        expect(mockRobot.moveMouse).toHaveBeenCalledWith(expectedX, expectedY);
      }
    });

    test('should handle different mouse event types', async () => {
      const eventTypes = ['down', 'up', 'move'];
      
      for (const eventType of eventTypes) {
        mockRobot.mouseToggle.mockClear();
        mockRobot.moveMouse.mockClear();
        
        const mouseEvent = {
          type: 'mouse-event',
          x: 100,
          y: 100,
          eventType,
          screenWidth: 800,
          screenHeight: 600
        };

        await mockWs.simulateMessage(Buffer.from(JSON.stringify(mouseEvent)));

        expect(mockRobot.moveMouse).toHaveBeenCalled();
        
        if (eventType === 'down') {
          expect(mockRobot.mouseToggle).toHaveBeenCalledWith('down', 'left');
        } else if (eventType === 'up') {
          expect(mockRobot.mouseToggle).toHaveBeenCalledWith('up', 'left');
        } else {
          expect(mockRobot.mouseToggle).not.toHaveBeenCalled();
        }
      }
    });
  });

  describe('Command Recognition', () => {
    test('should recognize supported commands', () => {
      // Mock Commands object
      const mockCommands = {
        'SAVE': 'save',
        'COPY': 'copy',
        'PASTE': 'paste'
      };

      jest.doMock('../src/commanding/commands', () => ({
        Commands: mockCommands
      }));

      const supportedCommands = [
        'save',
        'copy', 
        'paste',
        'type hello',
        'keytap enter',
        'go to line 50',
        'open file test.js',
        'search function',
        'replace old new',
        '@cline help'
      ];

      for (const command of supportedCommands) {
        const isSupported = (vncConnection as any).isSupportedCommand(command);
        expect(isSupported).toBe(true);
      }
    });

    test('should not recognize unsupported commands', () => {
      const unsupportedCommands = [
        'unknown command',
        'random text',
        'not a command'
      ];

      for (const command of unsupportedCommands) {
        const isSupported = (vncConnection as any).isSupportedCommand(command);
        expect(isSupported).toBe(false);
      }
    });
  });

  describe('Frame Subscription and Transmission', () => {
    test('should send single frame updates correctly', async () => {
      const mockFrameBuffer = Buffer.from('mock-frame-data');
      const mockDimensions = { width: 1200, height: 675 };

      // Simulate frame subscription callback
      const callback = (vncConnection as any).subscribers?.[0];
      if (callback) {
        callback(mockFrameBuffer, mockDimensions);
      }

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'screen-update',
          image: mockFrameBuffer.toString('base64'),
          dimensions: mockDimensions
        })
      );
    });

    test('should send chunked frame updates correctly', async () => {
      const mockChunks = [
        Buffer.from('chunk1'),
        Buffer.from('chunk2'),
        Buffer.from('chunk3')
      ];
      const mockChunkedFrame = {
        chunks: mockChunks,
        total: 3,
        dimensions: { width: 1200, height: 675 }
      };
      const mockDimensions = { width: 1200, height: 675 };

      // Simulate chunked frame callback
      const callback = (vncConnection as any).subscribers?.[0];
      if (callback) {
        callback(mockChunkedFrame, mockDimensions);
      }

      // Verify all chunks were sent
      expect(mockWs.send).toHaveBeenCalledTimes(3);

      // Verify chunk structure
      mockChunks.forEach((chunk, index) => {
        expect(mockWs.send).toHaveBeenCalledWith(
          JSON.stringify({
            type: 'screen-update-chunk',
            chunk: chunk.toString('base64'),
            chunkIndex: index,
            totalChunks: 3,
            dimensions: mockDimensions,
            isLastChunk: index === 2
          })
        );
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle mouse event errors gracefully', async () => {
      // Mock robot to throw an error
      mockRobot.moveMouse.mockImplementation(() => {
        throw new Error('Robot mouse error');
      });

      const mouseEvent = {
        type: 'mouse-event',
        x: 100,
        y: 50,
        eventType: 'down',
        screenWidth: 800,
        screenHeight: 600
      };

      // Should not throw
      await expect(
        mockWs.simulateMessage(Buffer.from(JSON.stringify(mouseEvent)))
      ).resolves.not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        'Error handling mouse event:',
        expect.any(Error)
      );
    });

    test('should handle keyboard event errors gracefully', async () => {
      // Mock robot to throw an error
      mockRobot.keyTap.mockImplementation(() => {
        throw new Error('Robot keyboard error');
      });

      const keyboardEvent = {
        type: 'keyboard-event',
        key: 'a'
      };

      // Should not throw
      await expect(
        mockWs.simulateMessage(Buffer.from(JSON.stringify(keyboardEvent)))
      ).resolves.not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        'Error handling keyboard event:',
        expect.any(Error)
      );
    });

    test('should handle malformed JSON messages', async () => {
      const malformedJson = '{invalid json';

      // Should not throw and should attempt to handle as command/file
      await expect(
        mockWs.simulateMessage(Buffer.from(malformedJson))
      ).resolves.not.toThrow();
    });
  });

  describe('Connection Lifecycle', () => {
    test('should dispose properly when connection closes', () => {
      const disposeSpy = jest.spyOn(vncConnection, 'dispose');
      
      mockWs.simulateClose();
      
      expect(disposeSpy).toHaveBeenCalled();
    });

    test('should unsubscribe from frame updates on disposal', () => {
      const unsubscribeSpy = jest.fn();
      (vncConnection as any).unsubscribe = unsubscribeSpy;
      
      vncConnection.dispose();
      
      expect(unsubscribeSpy).toHaveBeenCalled();
      expect((vncConnection as any).unsubscribe).toBeNull();
    });
  });

  describe('String Message Handling', () => {
    test('should handle quality update string messages', async () => {
      const qualityUpdate = JSON.stringify({
        type: 'quality-update',
        width: 1000,
        jpegQuality: 80
      });

      // Mock ScreenCaptureManager
      const mockManager = {
        updateQualitySettings: jest.fn()
      };
      
      // Should handle quality update
      await mockWs.simulateMessage(qualityUpdate);
      
      // Would need to verify the actual implementation behavior
      // This depends on how the code actually handles string messages
    });

    test('should handle AI chat messages', async () => {
      // Mock the chatWithOpenAI function
      const mockChatResponse = 'AI response to user input';
      
      jest.doMock('../src/ai/api', () => ({
        chatWithOpenAI: jest.fn().mockResolvedValue(mockChatResponse)
      }));

      // Mock store
      const mockStore = {
        getState: jest.fn(() => ({
          apiKey: 'test-api-key',
          webview: {
            panel: {
              webview: {
                postMessage: jest.fn()
              }
            }
          }
        }))
      };

      jest.doMock('../src/state/store', () => ({
        store: mockStore
      }));

      const userMessage = 'Hello AI, help me with code';
      
      await mockWs.simulateMessage(userMessage);
      
      // Verify AI chat was called with proper parameters
      // Implementation details would depend on actual code structure
    });
  });
});