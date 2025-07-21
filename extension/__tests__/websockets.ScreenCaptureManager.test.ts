import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock vscode module before importing websockets
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

// We need to access the ScreenCaptureManager class for testing
// Since it's not exported, we'll need to create a test version or access it via reflection
class TestableScreenCaptureManager {
  private static instance: any;
  
  // Access the private constructor for testing
  static createTestInstance(mockScreenSize = { width: 1920, height: 1080 }) {
    // Mock the robot.getScreenSize method
    const mockRobot = require('../src/commanding/robotjs-handlers');
    jest.spyOn(mockRobot.typedRobot, 'getScreenSize').mockReturnValue(mockScreenSize);
    
    // Import the websockets module after mocking
    const websocketsModule = require('../src/websockets');
    
    // Reset singleton instance for testing
    (websocketsModule as any).ScreenCaptureManager.instance = null;
    
    return (websocketsModule as any).ScreenCaptureManager.getInstance();
  }

  static resetInstance() {
    TestableScreenCaptureManager.instance = null;
  }
}

describe('ScreenCaptureManager', () => {
  let manager: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    TestableScreenCaptureManager.resetInstance();
  });

  afterEach(() => {
    // Clean up any intervals/timeouts
    if (manager && manager.stopCaptureLoop) {
      manager.stopCaptureLoop();
    }
  });

  describe('Resolution Profile Detection', () => {
    test('should detect 8K+ profile for ultra-high resolution displays', () => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 7680, height: 4320 });
      const resolutionInfo = manager.getResolutionInfo();
      
      expect(resolutionInfo.profile).toBe('8K+');
      expect(resolutionInfo.currentSettings.width).toBe(960);
      expect(resolutionInfo.currentSettings.jpegQuality).toBe(70);
      expect(resolutionInfo.currentSettings.fps).toBe(20);
    });

    test('should detect 5K-6K profile for 5K displays', () => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 5120, height: 2880 });
      const resolutionInfo = manager.getResolutionInfo();
      
      expect(resolutionInfo.profile).toBe('5K-6K');
      expect(resolutionInfo.currentSettings.width).toBe(1024);
      expect(resolutionInfo.currentSettings.jpegQuality).toBe(75);
      expect(resolutionInfo.currentSettings.fps).toBe(25);
    });

    test('should detect 4K profile for 4K displays', () => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 3840, height: 2160 });
      const resolutionInfo = manager.getResolutionInfo();
      
      expect(resolutionInfo.profile).toBe('4K');
      expect(resolutionInfo.currentSettings.width).toBe(1200);
      expect(resolutionInfo.currentSettings.jpegQuality).toBe(80);
      expect(resolutionInfo.currentSettings.fps).toBe(30);
    });

    test('should detect Ultrawide profile for ultrawide displays', () => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 3440, height: 1440 });
      const resolutionInfo = manager.getResolutionInfo();
      
      expect(resolutionInfo.profile).toBe('Ultrawide');
      expect(resolutionInfo.currentSettings.width).toBe(1280);
      expect(resolutionInfo.currentSettings.jpegQuality).toBe(82);
      expect(resolutionInfo.currentSettings.fps).toBe(35);
    });

    test('should detect QHD profile for QHD displays', () => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 2560, height: 1440 });
      const resolutionInfo = manager.getResolutionInfo();
      
      expect(resolutionInfo.profile).toBe('QHD');
      expect(resolutionInfo.currentSettings.width).toBe(1440);
      expect(resolutionInfo.currentSettings.jpegQuality).toBe(85);
      expect(resolutionInfo.currentSettings.fps).toBe(40);
    });

    test('should detect FHD profile for Full HD displays', () => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 1920, height: 1080 });
      const resolutionInfo = manager.getResolutionInfo();
      
      expect(resolutionInfo.profile).toBe('FHD');
      expect(resolutionInfo.currentSettings.width).toBe(1440);
      expect(resolutionInfo.currentSettings.jpegQuality).toBe(85);
      expect(resolutionInfo.currentSettings.fps).toBe(45);
    });

    test('should fallback to FHD profile for unknown resolutions', () => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 800, height: 600 });
      const resolutionInfo = manager.getResolutionInfo();
      
      expect(resolutionInfo.profile).toBe('FHD');
      expect(resolutionInfo.currentSettings.width).toBe(1440);
      expect(resolutionInfo.currentSettings.jpegQuality).toBe(85);
      expect(resolutionInfo.currentSettings.fps).toBe(45);
    });
  });

  describe('Quality Settings Management', () => {
    beforeEach(() => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 1920, height: 1080 });
    });

    test('should update quality settings within valid ranges', () => {
      const initialSettings = manager.getQualitySettings();
      
      manager.updateQualitySettings({
        width: 1200,
        jpegQuality: 75,
        fps: 30
      });
      
      const updatedSettings = manager.getQualitySettings();
      expect(updatedSettings.width).toBe(1200);
      expect(updatedSettings.jpegQuality).toBe(75);
      expect(updatedSettings.fps).toBe(30);
    });

    test('should reject quality settings outside valid ranges', () => {
      const initialSettings = manager.getQualitySettings();
      
      manager.updateQualitySettings({
        width: 500, // Below MIN_WIDTH (800)
        jpegQuality: 50, // Below MIN_QUALITY (60)
        fps: 100 // Above max fps (60)
      });
      
      const updatedSettings = manager.getQualitySettings();
      // Settings should remain unchanged
      expect(updatedSettings.width).toBe(initialSettings.width);
      expect(updatedSettings.jpegQuality).toBe(initialSettings.jpegQuality);
      expect(updatedSettings.fps).toBe(initialSettings.fps);
    });

    test('should accept boundary values for quality settings', () => {
      manager.updateQualitySettings({
        width: 800, // MIN_WIDTH
        jpegQuality: 60, // MIN_QUALITY
        fps: 1 // Min fps
      });
      
      let settings = manager.getQualitySettings();
      expect(settings.width).toBe(800);
      expect(settings.jpegQuality).toBe(60);
      expect(settings.fps).toBe(1);

      manager.updateQualitySettings({
        width: 1920, // MAX_WIDTH
        jpegQuality: 90, // MAX_QUALITY
        fps: 60 // Max fps
      });
      
      settings = manager.getQualitySettings();
      expect(settings.width).toBe(1920);
      expect(settings.jpegQuality).toBe(90);
      expect(settings.fps).toBe(60);
    });
  });

  describe('Memory Management', () => {
    beforeEach(() => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 1920, height: 1080 });
    });

    test('should track memory usage correctly', () => {
      const initialInfo = manager.getResolutionInfo();
      expect(initialInfo.memoryUsage).toBe('0.0MB');
      expect(initialInfo.memoryPressure).toBe(false);
      
      // Simulate memory usage by calling updateMemoryUsage method
      const frameSize = 100 * 1024; // 100KB
      manager.updateMemoryUsage(frameSize, true);
      
      const updatedInfo = manager.getResolutionInfo();
      expect(parseFloat(updatedInfo.memoryUsage)).toBeGreaterThan(0);
    });

    test('should detect memory pressure when usage exceeds limit', () => {
      // Simulate high memory usage (over 512MB limit)
      const largeFrameSize = 600 * 1024 * 1024; // 600MB
      manager.updateMemoryUsage(largeFrameSize, true);
      
      const info = manager.getResolutionInfo();
      expect(info.memoryPressure).toBe(true);
    });

    test('should decrease memory usage when frames are cleaned up', () => {
      const frameSize = 100 * 1024; // 100KB
      
      // Add memory
      manager.updateMemoryUsage(frameSize, true);
      let info = manager.getResolutionInfo();
      const memoryAfterAdd = parseFloat(info.memoryUsage);
      expect(memoryAfterAdd).toBeGreaterThan(0);
      
      // Remove memory
      manager.updateMemoryUsage(frameSize, false);
      info = manager.getResolutionInfo();
      const memoryAfterRemove = parseFloat(info.memoryUsage);
      expect(memoryAfterRemove).toBe(0);
    });
  });

  describe('Adaptive Interval Calculation', () => {
    test('should increase interval for 4K+ displays', () => {
      const manager4K = TestableScreenCaptureManager.createTestInstance({ width: 3840, height: 2160 });
      const managerHD = TestableScreenCaptureManager.createTestInstance({ width: 1920, height: 1080 });
      
      // Use reflection to access private method
      const interval4K = (manager4K as any).calculateAdaptiveInterval();
      const intervalHD = (managerHD as any).calculateAdaptiveInterval();
      
      expect(interval4K).toBeGreaterThanOrEqual(50); // 4K should have at least 50ms interval
      expect(interval4K).toBeGreaterThan(intervalHD);
    });

    test('should increase interval for QHD+ displays', () => {
      const managerQHD = TestableScreenCaptureManager.createTestInstance({ width: 2560, height: 1440 });
      const managerHD = TestableScreenCaptureManager.createTestInstance({ width: 1920, height: 1080 });
      
      const intervalQHD = (managerQHD as any).calculateAdaptiveInterval();
      const intervalHD = (managerHD as any).calculateAdaptiveInterval();
      
      expect(intervalQHD).toBeGreaterThanOrEqual(40); // QHD should have at least 40ms interval
      expect(intervalQHD).toBeGreaterThan(intervalHD);
    });

    test('should further increase interval under memory pressure', () => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 1920, height: 1080 });
      
      const normalInterval = (manager as any).calculateAdaptiveInterval();
      
      // Simulate memory pressure
      manager.updateMemoryUsage(600 * 1024 * 1024, true); // 600MB
      const pressureInterval = (manager as any).calculateAdaptiveInterval();
      
      expect(pressureInterval).toBeGreaterThan(normalInterval * 1.4); // Should be ~1.5x higher
    });
  });

  describe('Frame Hashing', () => {
    beforeEach(() => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 1920, height: 1080 });
    });

    test('should generate consistent hashes for identical frames', () => {
      const frameBuffer = Buffer.alloc(1000, 100); // Mock frame buffer
      
      const hash1 = (manager as any).calculateFrameHash(frameBuffer);
      const hash2 = (manager as any).calculateFrameHash(frameBuffer);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toBe('mock-hash-12345'); // From our crypto mock
    });

    test('should generate different hashes for different frames', () => {
      const frameBuffer1 = Buffer.alloc(1000, 100);
      const frameBuffer2 = Buffer.alloc(1000, 200);
      
      // Mock different hash outputs
      const mockCreateHash = require('crypto').createHash;
      mockCreateHash
        .mockReturnValueOnce({
          update: jest.fn().mockReturnThis(),
          digest: jest.fn(() => 'hash-frame1')
        })
        .mockReturnValueOnce({
          update: jest.fn().mockReturnThis(),
          digest: jest.fn(() => 'hash-frame2')
        });
      
      const hash1 = (manager as any).calculateFrameHash(frameBuffer1);
      const hash2 = (manager as any).calculateFrameHash(frameBuffer2);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Frame Chunking', () => {
    beforeEach(() => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 3840, height: 2160 }); // 4K display
    });

    test('should create chunks for large frames', () => {
      const largeFrame = Buffer.alloc(2 * 1024 * 1024, 0); // 2MB frame
      
      const chunkedFrame = (manager as any).createChunkedFrame(largeFrame);
      
      expect(chunkedFrame.chunks.length).toBeGreaterThan(1);
      expect(chunkedFrame.total).toBe(chunkedFrame.chunks.length);
      expect(chunkedFrame.dimensions).toBeDefined();
      
      // Verify chunks don't exceed chunk size (32KB)
      chunkedFrame.chunks.forEach((chunk: Buffer) => {
        expect(chunk.length).toBeLessThanOrEqual(32 * 1024);
      });
      
      // Verify total size is preserved
      const totalChunkSize = chunkedFrame.chunks.reduce((sum: number, chunk: Buffer) => sum + chunk.length, 0);
      expect(totalChunkSize).toBe(largeFrame.length);
    });

    test('should handle single chunk for small frames', () => {
      const smallFrame = Buffer.alloc(16 * 1024, 0); // 16KB frame
      
      const chunkedFrame = (manager as any).createChunkedFrame(smallFrame);
      
      expect(chunkedFrame.chunks.length).toBe(1);
      expect(chunkedFrame.total).toBe(1);
      expect(chunkedFrame.chunks[0].length).toBe(smallFrame.length);
    });
  });

  describe('Performance Monitoring', () => {
    beforeEach(() => {
      manager = TestableScreenCaptureManager.createTestInstance({ width: 1920, height: 1080 });
    });

    test('should track frame processing times', () => {
      const processingTime1 = 25.5;
      const processingTime2 = 30.2;
      
      (manager as any).updatePerformanceMetrics(processingTime1);
      (manager as any).updatePerformanceMetrics(processingTime2);
      
      const avgTime = (manager as any).getAverageProcessingTime();
      expect(avgTime).toBeCloseTo((processingTime1 + processingTime2) / 2, 1);
    });

    test('should detect high motion based on processing times', () => {
      // Add several high processing times
      for (let i = 0; i < 5; i++) {
        (manager as any).updatePerformanceMetrics(40); // High processing time
      }
      
      const highMotion = (manager as any).detectHighMotion();
      expect(highMotion).toBe(true);
    });

    test('should detect low motion with low processing times', () => {
      // Add several low processing times
      for (let i = 0; i < 5; i++) {
        (manager as any).updatePerformanceMetrics(10); // Low processing time
      }
      
      const highMotion = (manager as any).detectHighMotion();
      expect(highMotion).toBe(false);
    });

    test('should identify slow processing', () => {
      // Add high processing times
      for (let i = 0; i < 3; i++) {
        (manager as any).updatePerformanceMetrics(50); // Very high processing time
      }
      
      const slowProcessing = (manager as any).isProcessingSlow();
      expect(slowProcessing).toBe(true);
    });
  });
});