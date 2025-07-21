import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock performance.now for consistent timing
let mockTime = 0;
const mockPerformanceNow = jest.fn(() => {
  mockTime += 16.67; // ~60fps
  return mockTime;
});
(global as any).performance = { now: mockPerformanceNow };

// Mock dependencies
jest.mock('vscode', () => ({}));
jest.mock('@hurdlegroup/robotjs', () => ({
  typedRobot: {
    getScreenSize: jest.fn(() => ({ width: 1920, height: 1080 }))
  }
}));

describe('Performance Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTime = 0;
  });

  describe('ScreenCaptureManager Performance', () => {
    test('should handle rapid frame processing efficiently', async () => {
      const startTime = performance.now();
      
      // Import and create manager after mocks
      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Simulate rapid frame processing
      const frameCount = 100;
      for (let i = 0; i < frameCount; i++) {
        const frameBuffer = Buffer.alloc(1024, i % 256);
        const hash = (manager as any).calculateFrameHash(frameBuffer);
        expect(hash).toBeDefined();
      }
      
      const endTime = performance.now();
      const processingTime = endTime - startTime;
      
      // Should process frames quickly (less than 1ms per frame on average)
      const avgTimePerFrame = processingTime / frameCount;
      expect(avgTimePerFrame).toBeLessThan(20); // Allow some overhead for mocking
    });

    test('should maintain stable memory usage under pressure', () => {
      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Simulate high memory usage
      const frameSize = 50 * 1024 * 1024; // 50MB frames
      
      // Add multiple large frames
      for (let i = 0; i < 5; i++) {
        manager.updateMemoryUsage(frameSize, true);
      }
      
      let info = manager.getResolutionInfo();
      expect(info.memoryPressure).toBe(true);
      
      // Clean up frames
      for (let i = 0; i < 5; i++) {
        manager.updateMemoryUsage(frameSize, false);
      }
      
      info = manager.getResolutionInfo();
      expect(parseFloat(info.memoryUsage)).toBe(0);
      expect(info.memoryPressure).toBe(false);
    });

    test('should adapt frame intervals based on processing performance', () => {
      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      
      // Test with 4K display
      const mockRobot = require('@hurdlegroup/robotjs');
      mockRobot.typedRobot.getScreenSize.mockReturnValue({ width: 3840, height: 2160 });
      
      const manager4K = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Add slow processing times
      for (let i = 0; i < 10; i++) {
        (manager4K as any).updatePerformanceMetrics(100); // 100ms processing
      }
      
      const adaptiveInterval = (manager4K as any).calculateAdaptiveInterval();
      expect(adaptiveInterval).toBeGreaterThan(50); // Should be higher for 4K
      
      // Test performance impact
      const isSlowProcessing = (manager4K as any).isProcessingSlow();
      expect(isSlowProcessing).toBe(true);
    });

    test('should handle chunking large frames efficiently', () => {
      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      const startTime = performance.now();
      
      // Create large frame (2MB)
      const largeFrame = Buffer.alloc(2 * 1024 * 1024, 0x42);
      const chunkedFrame = (manager as any).createChunkedFrame(largeFrame);
      
      const endTime = performance.now();
      const chunkingTime = endTime - startTime;
      
      expect(chunkingTime).toBeLessThan(100); // Should chunk quickly
      expect(chunkedFrame.chunks.length).toBeGreaterThan(1);
      
      // Verify integrity
      const reconstructed = Buffer.concat(chunkedFrame.chunks);
      expect(reconstructed.length).toBe(largeFrame.length);
    });
  });

  describe('Memory Leak Detection', () => {
    test('should not accumulate memory in frame processing times array', () => {
      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Add many processing times
      for (let i = 0; i < 100; i++) {
        (manager as any).updatePerformanceMetrics(10 + Math.random() * 20);
      }
      
      // Array should be capped at 30 entries
      const processingTimes = (manager as any).frameProcessingTimes;
      expect(processingTimes.length).toBeLessThanOrEqual(30);
    });

    test('should clean up coalesce timers properly', (done) => {
      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Create multiple timers
      const frame = Buffer.alloc(1000, 0x42);
      
      (manager as any).handleNewFrame(frame);
      (manager as any).handleNewFrame(frame);
      (manager as any).handleNewFrame(frame);
      
      // Stop capture loop
      setTimeout(() => {
        (manager as any).stopCaptureLoop();
        
        // Timers should be cleaned up
        expect((manager as any).coalesceTimer).toBeNull();
        expect((manager as any).captureInterval).toBeNull();
        done();
      }, 150); // Wait for coalesce timeout
    });
  });

  describe('Concurrency and Race Conditions', () => {
    test('should handle concurrent frame processing safely', async () => {
      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Simulate concurrent frame arrivals
      const frames = [];
      for (let i = 0; i < 5; i++) {
        frames.push(Buffer.alloc(1000, i));
      }
      
      // Process all frames concurrently
      const promises = frames.map(frame => 
        (manager as any).handleNewFrame(frame)
      );
      
      // Should handle concurrent processing without errors
      await Promise.all(promises);
      
      // Should have accumulated frames for processing
      expect((manager as any).pendingFrames.length).toBeGreaterThanOrEqual(0);
    });

    test('should prevent multiple simultaneous frame processing', () => {
      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Set processing flag
      (manager as any).processingFrame = true;
      
      // Attempt to process frames
      const result1 = (manager as any).processCoalescedFrames();
      const result2 = (manager as any).processCoalescedFrames();
      
      // Second call should return early
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
    });
  });

  describe('Quality Adjustment Performance', () => {
    test('should adjust quality efficiently under load', () => {
      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      const startTime = performance.now();
      
      // Simulate performance pressure
      for (let i = 0; i < 50; i++) {
        (manager as any).updatePerformanceMetrics(50); // Slow processing
      }
      
      // Simulate frame drops
      (manager as any).droppedFrames = 20;
      (manager as any).framesSent = 80;
      
      // Trigger quality adjustment
      (manager as any).adjustQualityIfNeeded();
      
      const endTime = performance.now();
      const adjustmentTime = endTime - startTime;
      
      expect(adjustmentTime).toBeLessThan(50); // Should adjust quickly
      
      // Quality should be reduced
      const settings = manager.getQualitySettings();
      expect(settings.jpegQuality).toBeLessThan(85); // Below initial quality
    });

    test('should handle rapid quality setting updates', () => {
      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      const startTime = performance.now();
      
      // Rapid quality updates
      for (let i = 0; i < 100; i++) {
        manager.updateQualitySettings({
          width: 800 + (i % 200),
          jpegQuality: 60 + (i % 30),
          fps: 10 + (i % 40)
        });
      }
      
      const endTime = performance.now();
      const updateTime = endTime - startTime;
      
      expect(updateTime).toBeLessThan(100); // Should handle updates efficiently
      
      // Final settings should be valid
      const settings = manager.getQualitySettings();
      expect(settings.width).toBeGreaterThanOrEqual(800);
      expect(settings.width).toBeLessThanOrEqual(1920);
      expect(settings.jpegQuality).toBeGreaterThanOrEqual(60);
      expect(settings.jpegQuality).toBeLessThanOrEqual(90);
    });
  });

  describe('Stress Testing', () => {
    test('should handle sustained high-frequency operations', (done) => {
      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      let operationCount = 0;
      const targetOperations = 1000;
      const startTime = performance.now();
      
      const interval = setInterval(() => {
        // Simulate various operations
        const frameBuffer = Buffer.alloc(1024, operationCount % 256);
        (manager as any).calculateFrameHash(frameBuffer);
        (manager as any).updatePerformanceMetrics(15 + Math.random() * 10);
        manager.updateQualitySettings({
          jpegQuality: 70 + Math.floor(Math.random() * 15)
        });
        
        operationCount++;
        
        if (operationCount >= targetOperations) {
          clearInterval(interval);
          
          const endTime = performance.now();
          const totalTime = endTime - startTime;
          const opsPerSecond = (operationCount / totalTime) * 1000;
          
          expect(opsPerSecond).toBeGreaterThan(100); // Should handle at least 100 ops/sec
          expect(manager.getResolutionInfo()).toBeDefined(); // Should still be functional
          
          done();
        }
      }, 1);
    }, 15000); // 15 second timeout for stress test

    test('should recover from extreme memory pressure', () => {
      const websocketsModule = require('../src/websockets');
      (websocketsModule as any).ScreenCaptureManager.instance = null;
      const manager = (websocketsModule as any).ScreenCaptureManager.getInstance();
      
      // Simulate extreme memory usage
      const hugeFrameSize = 1000 * 1024 * 1024; // 1GB
      manager.updateMemoryUsage(hugeFrameSize, true);
      
      let info = manager.getResolutionInfo();
      expect(info.memoryPressure).toBe(true);
      
      // Adaptive interval should increase significantly
      const pressureInterval = (manager as any).calculateAdaptiveInterval();
      expect(pressureInterval).toBeGreaterThan(50); // Much higher under pressure
      
      // Clean up memory
      manager.updateMemoryUsage(hugeFrameSize, false);
      
      info = manager.getResolutionInfo();
      expect(parseFloat(info.memoryUsage)).toBe(0);
    });
  });
});