import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock vscode API
const mockVSCode = {
  commands: {
    executeCommand: jest.fn()
  },
  window: {
    activeTextEditor: {
      selection: null,
      revealRange: jest.fn()
    },
    showTextDocument: jest.fn()
  },
  workspace: {
    openTextDocument: jest.fn().mockResolvedValue({})
  },
  Position: jest.fn((line: number, char: number) => ({ line, char })),
  Selection: jest.fn((pos1: any, pos2: any) => ({ start: pos1, end: pos2 })),
  Range: jest.fn((pos1: any, pos2: any) => ({ start: pos1, end: pos2 }))
};

jest.mock('vscode', () => mockVSCode);

// Mock WebSocket
const mockWebSocket = {
  send: jest.fn(),
  readyState: 1
};

// Mock RobotJS handlers
const mockRobotJSHandlers = {
  type: jest.fn(),
  typeAndEnter: jest.fn(),
  search: jest.fn(),
  replace: jest.fn(),
  enter: jest.fn(),
  escape: jest.fn(),
  backspace: jest.fn()
};

jest.mock('../src/commanding/robotjs-handlers', () => ({
  RobotJSCommandHandlers: mockRobotJSHandlers
}));

// Mock commands
const mockBuiltInCommands = {
  'save': 'workbench.action.files.save',
  'copy': 'editor.action.clipboardCopyAction',
  'paste': 'editor.action.clipboardPasteAction'
};

const mockCommands = {
  SAVE: 'save',
  COPY: 'copy',
  PASTE: 'paste'
};

jest.mock('../src/commanding/commands', () => ({
  BuiltInCommands: mockBuiltInCommands,
  Commands: mockCommands
}));

// Mock AI API
jest.mock('../src/ai/api', () => ({
  chatWithOpenAI: jest.fn().mockResolvedValue('AI response')
}));

jest.mock('../src/ai/utils', () => ({
  getApiKey: jest.fn(() => 'test-api-key')
}));

// Mock screenshot handler
jest.mock('../src/commanding/screenshot-handler', () => ({
  takeAndSendScreenshot: jest.fn()
}));

// Mock store
const mockStore = {
  getState: jest.fn(() => ({
    webview: {
      panel: {
        webview: {
          postMessage: jest.fn()
        }
      }
    }
  }))
};

jest.mock('../src/state/store', () => ({
  store: mockStore
}));

describe('Command Handler', () => {
  let handleCommand: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Import after setting up mocks
    const commandHandlerModule = await import('../src/commanding/command-handler');
    handleCommand = commandHandlerModule.handleCommand;
  });

  describe('Built-in Commands', () => {
    test('should execute VS Code built-in commands', async () => {
      await handleCommand('save' as any, mockWebSocket as any);
      
      expect(mockVSCode.commands.executeCommand).toHaveBeenCalledWith(
        'workbench.action.files.save'
      );
    });

    test('should execute copy command', async () => {
      await handleCommand('copy' as any, mockWebSocket as any);
      
      expect(mockVSCode.commands.executeCommand).toHaveBeenCalledWith(
        'editor.action.clipboardCopyAction'
      );
    });

    test('should execute paste command', async () => {
      await handleCommand('paste' as any, mockWebSocket as any);
      
      expect(mockVSCode.commands.executeCommand).toHaveBeenCalledWith(
        'editor.action.clipboardPasteAction'
      );
    });
  });

  describe('Text Input Commands', () => {
    test('should handle type command', async () => {
      await handleCommand('type hello world' as any, mockWebSocket as any);
      
      expect(mockRobotJSHandlers.type).toHaveBeenCalledWith('hello world');
    });

    test('should handle type and enter command', async () => {
      await handleCommand('type hello and enter' as any, mockWebSocket as any);
      
      expect(mockRobotJSHandlers.typeAndEnter).toHaveBeenCalledWith('hello');
    });

    test('should handle type command with special characters', async () => {
      await handleCommand('type const x = "test";' as any, mockWebSocket as any);
      
      expect(mockRobotJSHandlers.type).toHaveBeenCalledWith('const x = "test";');
    });
  });

  describe('Key Tap Commands', () => {
    test('should handle keytap enter', async () => {
      await handleCommand('keytap enter' as any, mockWebSocket as any);
      
      expect(mockRobotJSHandlers.enter).toHaveBeenCalled();
    });

    test('should handle keytap escape', async () => {
      await handleCommand('keytap escape' as any, mockWebSocket as any);
      
      expect(mockRobotJSHandlers.escape).toHaveBeenCalled();
    });

    test('should handle keytap backspace', async () => {
      await handleCommand('keytap backspace' as any, mockWebSocket as any);
      
      expect(mockRobotJSHandlers.backspace).toHaveBeenCalled();
    });

    test('should warn on unhandled keytap commands', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      await handleCommand('keytap unknownkey' as any, mockWebSocket as any);
      
      expect(consoleSpy).toHaveBeenCalledWith('Unhandled keytap command:', 'unknownkey');
      consoleSpy.mockRestore();
    });
  });

  describe('Search Commands', () => {
    test('should handle search command', async () => {
      await handleCommand('search function' as any, mockWebSocket as any);
      
      expect(mockRobotJSHandlers.search).toHaveBeenCalledWith('function');
    });

    test('should handle search with multiple words', async () => {
      await handleCommand('search const variable' as any, mockWebSocket as any);
      
      expect(mockRobotJSHandlers.search).toHaveBeenCalledWith('const variable');
    });
  });

  describe('Replace Commands', () => {
    test('should handle replace command', async () => {
      await handleCommand('replace old with new' as any, mockWebSocket as any);
      
      expect(mockRobotJSHandlers.replace).toHaveBeenCalledWith('old', 'new');
    });

    test('should handle replace with complex terms', async () => {
      await handleCommand('replace const oldVar with let newVar' as any, mockWebSocket as any);
      
      expect(mockRobotJSHandlers.replace).toHaveBeenCalledWith('const oldVar', 'let newVar');
    });

    test('should log query and replacement', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await handleCommand('replace test with result' as any, mockWebSocket as any);
      
      expect(consoleSpy).toHaveBeenCalledWith('query', 'test');
      expect(consoleSpy).toHaveBeenCalledWith('replacement', 'result');
      consoleSpy.mockRestore();
    });
  });

  describe('Navigation Commands', () => {
    test('should handle go to line command', async () => {
      mockVSCode.window.activeTextEditor = {
        selection: null,
        revealRange: jest.fn()
      };
      
      await handleCommand('go to line 42' as any, mockWebSocket as any);
      
      expect(mockVSCode.Position).toHaveBeenCalledWith(41, 0); // Line numbers are 0-indexed
      expect(mockVSCode.Selection).toHaveBeenCalled();
      expect(mockVSCode.Range).toHaveBeenCalled();
      expect(mockVSCode.window.activeTextEditor.revealRange).toHaveBeenCalled();
    });

    test('should handle go to line with invalid line number', async () => {
      mockVSCode.window.activeTextEditor = {
        selection: null,
        revealRange: jest.fn()
      };
      
      await handleCommand('go to line abc' as any, mockWebSocket as any);
      
      // Should not call Position/Selection for invalid line number
      expect(mockVSCode.Position).not.toHaveBeenCalled();
    });

    test('should handle go to line when no active editor', async () => {
      mockVSCode.window.activeTextEditor = null;
      
      await handleCommand('go to line 10' as any, mockWebSocket as any);
      
      // Should return early when no active editor
      expect(mockVSCode.Position).not.toHaveBeenCalled();
    });
  });

  describe('File Operations', () => {
    test('should handle open file command', async () => {
      await handleCommand('open file test.js' as any, mockWebSocket as any);
      
      expect(mockVSCode.workspace.openTextDocument).toHaveBeenCalledWith(' test.js');
      expect(mockVSCode.window.showTextDocument).toHaveBeenCalled();
    });

    test('should handle open file with path', async () => {
      await handleCommand('open file src/utils/helper.ts' as any, mockWebSocket as any);
      
      expect(mockVSCode.workspace.openTextDocument).toHaveBeenCalledWith(' src/utils/helper.ts');
    });
  });

  describe('Custom Commands', () => {
    test('should handle get screenshot command', async () => {
      const { takeAndSendScreenshot } = require('../src/commanding/screenshot-handler');
      
      await handleCommand('get screenshot' as any, mockWebSocket as any);
      
      expect(takeAndSendScreenshot).toHaveBeenCalledWith(mockWebSocket);
    });
  });

  describe('AI Chat Fallback', () => {
    test('should fallback to AI chat for unknown commands', async () => {
      const { chatWithOpenAI } = require('../src/ai/api');
      const mockPanel = mockStore.getState().webview.panel;
      
      await handleCommand('unknown command' as any, mockWebSocket as any);
      
      expect(chatWithOpenAI).toHaveBeenCalledWith('unknown command', 'test-api-key');
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'chatResponse',
        response: 'AI response'
      });
    });

    test('should handle AI chat errors', async () => {
      const { chatWithOpenAI } = require('../src/ai/api');
      const mockPanel = mockStore.getState().webview.panel;
      
      chatWithOpenAI.mockRejectedValueOnce(new Error('AI API Error'));
      
      await handleCommand('test ai error' as any, mockWebSocket as any);
      
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'error',
        message: expect.any(String)
      });
    });

    test('should warn about unhandled commands before AI fallback', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      await handleCommand('random text' as any, mockWebSocket as any);
      
      expect(consoleSpy).toHaveBeenCalledWith('Unhandled command:', 'random text');
      consoleSpy.mockRestore();
    });
  });

  describe('Command Logging', () => {
    test('should log all received commands', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await handleCommand('save' as any, mockWebSocket as any);
      
      expect(consoleSpy).toHaveBeenCalledWith('Received command:', 'save');
      consoleSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty type command', async () => {
      await handleCommand('type ' as any, mockWebSocket as any);
      
      expect(mockRobotJSHandlers.type).toHaveBeenCalledWith('');
    });

    test('should handle empty keytap command', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      await handleCommand('keytap ' as any, mockWebSocket as any);
      
      expect(consoleSpy).toHaveBeenCalledWith('Unhandled keytap command:', '');
      consoleSpy.mockRestore();
    });

    test('should handle empty search command', async () => {
      await handleCommand('search ' as any, mockWebSocket as any);
      
      expect(mockRobotJSHandlers.search).toHaveBeenCalledWith('');
    });

    test('should handle replace command without "with"', async () => {
      await handleCommand('replace oldtext' as any, mockWebSocket as any);
      
      // Should call replace with oldtext and undefined
      expect(mockRobotJSHandlers.replace).toHaveBeenCalledWith('oldtext', undefined);
    });

    test('should handle go to line without number', async () => {
      await handleCommand('go to line' as any, mockWebSocket as any);
      
      // Should not call Position for missing line number
      expect(mockVSCode.Position).not.toHaveBeenCalled();
    });
  });
});