import * as vscode from "vscode";
import * as WebSocket from "ws";
import { typedRobot as robot } from "./commanding/robotjs-handlers";
import screenshot from "screenshot-desktop";
import { handleCommand } from "./commanding/command-handler";
import { chatWithOpenAI } from "./ai/api";
import { handleFileUpload } from "./files/utils";
import { store } from "./state/store";
import {
  addWebSocketConnection,
  removeWebSocketConnection,
} from "./state/actions";
import crypto from "crypto";

import { Commands } from "./commanding/commands";
import jimp from "./jimp";
import { ResizeStrategy } from "jimp";

interface VNCQualitySettings {
  width: number;
  jpegQuality: number;
  fps: number;
}

interface ResolutionProfile {
  name: string;
  minWidth: number;
  defaultWidth: number;
  jpegQuality: number;
  fps: number;
  maxFrameSize: number; // in KB, for chunking threshold
}

/**
 * Manages screen capture for all connected clients.
 * Features frame coalescing and adaptive quality settings.
 */
class ScreenCaptureManager {
  private static instance: ScreenCaptureManager;
  private isCapturing = false;
  private captureInterval: NodeJS.Timeout | null = null;

  // Resolution profiles for different display types
  private readonly RESOLUTION_PROFILES: ResolutionProfile[] = [
    // Ultra high resolution (8K+)
    { name: "8K+", minWidth: 7680, defaultWidth: 960, jpegQuality: 70, fps: 20, maxFrameSize: 512 },
    // 5K/6K displays  
    { name: "5K-6K", minWidth: 5120, defaultWidth: 1024, jpegQuality: 75, fps: 25, maxFrameSize: 768 },
    // 4K displays
    { name: "4K", minWidth: 3840, defaultWidth: 1200, jpegQuality: 80, fps: 30, maxFrameSize: 1024 },
    // Ultrawide QHD (3440x1440)
    { name: "Ultrawide", minWidth: 3440, defaultWidth: 1280, jpegQuality: 82, fps: 35, maxFrameSize: 1024 },
    // Standard high resolution (QHD)
    { name: "QHD", minWidth: 2560, defaultWidth: 1440, jpegQuality: 85, fps: 40, maxFrameSize: 1280 },
    // Full HD and below
    { name: "FHD", minWidth: 0, defaultWidth: 1440, jpegQuality: 85, fps: 45, maxFrameSize: 1536 }
  ];

  // Current resolution profile and adaptive settings
  private currentProfile: ResolutionProfile;
  private quality: VNCQualitySettings;

  // Frame management
  private processingFrame = false;
  private lastFrameHash: string | null = null;
  private lastFrameSentTime = 0;
  private lastFrameSize = 0;

  // Frame coalescing
  private pendingFrames: Buffer[] = [];
  private coalesceTimer: NodeJS.Timeout | null = null;
  private readonly COALESCE_MAX_WAIT = 100; // ms
  private readonly MIN_FRAME_INTERVAL = 33;  // ~30fps cap

  // Performance tracking
  private frameProcessingTimes: number[] = [];
  private lastPerformanceCheck = Date.now();
  private droppedFrames = 0;
  private framesSent = 0;

  // Memory management
  private totalMemoryUsed = 0;
  private readonly MAX_MEMORY_MB = 512; // Maximum memory for frame buffers
  private memoryPressure = false;

  // Quality control with resolution-aware limits
  private readonly MIN_QUALITY = 60;  // More aggressive for high-res
  private readonly MAX_QUALITY = 90;
  private readonly MIN_WIDTH = 800;   // Lower minimum for high-res displays
  private readonly MAX_WIDTH = 1920;
  private readonly PERFORMANCE_CHECK_INTERVAL = 2000; // ms

  // Chunking configuration
  private readonly CHUNK_SIZE = 32 * 1024; // 32KB chunks
  private readonly CHUNK_HEADER_SIZE = 100; // JSON header overhead

  private subscribers: Array<(frame: Buffer | { chunks: Buffer[], total: number, dimensions: { width: number; height: number } }, dimensions: { width: number; height: number }) => void> = [];
  private screenSize = robot.getScreenSize();
  private cachedDimensions = this.getScaledDimensions();

  private constructor() {
    this.currentProfile = this.detectResolutionProfile();
    this.quality = this.initializeQualityFromProfile();
    this.cachedDimensions = this.getScaledDimensions();
    this.setupPerformanceMonitoring();
    
    console.log(`Detected resolution profile: ${this.currentProfile.name} (${this.screenSize.width}x${this.screenSize.height})`);
    console.log(`Initial settings: width=${this.quality.width}, quality=${this.quality.jpegQuality}, fps=${this.quality.fps}`);
  }

  public static getInstance(): ScreenCaptureManager {
    if (!ScreenCaptureManager.instance) {
      ScreenCaptureManager.instance = new ScreenCaptureManager();
    }
    return ScreenCaptureManager.instance;
  }

  private detectResolutionProfile(): ResolutionProfile {
    const { width } = this.screenSize;
    
    for (const profile of this.RESOLUTION_PROFILES) {
      if (width >= profile.minWidth) {
        return profile;
      }
    }
    
    // Fallback to lowest profile
    return this.RESOLUTION_PROFILES[this.RESOLUTION_PROFILES.length - 1];
  }

  private initializeQualityFromProfile(): VNCQualitySettings {
    return {
      width: this.currentProfile.defaultWidth,
      jpegQuality: this.currentProfile.jpegQuality, 
      fps: this.currentProfile.fps
    };
  }

  private updateMemoryUsage(frameSize: number, isAdd: boolean = true) {
    if (isAdd) {
      this.totalMemoryUsed += frameSize;
    } else {
      this.totalMemoryUsed = Math.max(0, this.totalMemoryUsed - frameSize);
    }
    
    const memoryMB = this.totalMemoryUsed / (1024 * 1024);
    this.memoryPressure = memoryMB > this.MAX_MEMORY_MB;
    
    if (this.memoryPressure && this.framesSent % 30 === 0) {
      console.warn(`Memory pressure detected: ${memoryMB.toFixed(1)}MB used`);
    }
  }

  private setupPerformanceMonitoring() {
    setInterval(() => {
      if (!this.isCapturing) return;

      const dropRate = (this.droppedFrames / (this.droppedFrames + this.framesSent)) * 100;
      const avgFrameSize = this.lastFrameSize / 1024;
      const avgProcessingTime = this.getAverageProcessingTime();
      const memoryMB = this.totalMemoryUsed / (1024 * 1024);

      console.debug(
        `[${this.currentProfile.name}] Performance: FPS=${this.framesSent}, Dropped=${this.droppedFrames}, ` +
        `Drop Rate=${dropRate.toFixed(1)}%, Size=${avgFrameSize.toFixed(1)}KB, ` +
        `Processing=${avgProcessingTime.toFixed(1)}ms, Quality=${this.quality.jpegQuality}, ` +
        `Memory=${memoryMB.toFixed(1)}MB${this.memoryPressure ? ' (PRESSURE)' : ''}`
      );

      this.droppedFrames = 0;
      this.framesSent = 0;
    }, 1000);
  }

  public subscribe(
    callback: (frame: Buffer | { chunks: Buffer[], total: number, dimensions: { width: number; height: number } }, dimensions: { width: number; height: number }) => void
  ): () => void {
    this.subscribers.push(callback);
    if (!this.isCapturing) {
      this.startCaptureLoop();
    }
    return () => {
      this.subscribers = this.subscribers.filter((cb) => cb !== callback);
      if (this.subscribers.length === 0) {
        this.stopCaptureLoop();
      }
    };
  }

  private startCaptureLoop() {
    if (this.isCapturing) return;
    this.isCapturing = true;

    const captureFrame = async () => {
      if (!this.isCapturing) return;

      const now = performance.now();
      const timeSinceLastFrame = now - this.lastFrameSentTime;

      // Enhanced frame skipping for high-resolution scenarios
      const adaptiveMinInterval = this.calculateAdaptiveInterval();
      
      // Skip frame if we're processing, it's too soon, or under memory pressure
      if (this.processingFrame || 
          timeSinceLastFrame < adaptiveMinInterval ||
          (this.memoryPressure && timeSinceLastFrame < adaptiveMinInterval * 1.5)) {
        this.droppedFrames++;
        return;
      }

      try {
        const raw = await screenshot();
        await this.handleNewFrame(raw);
      } catch (error) {
        console.error("Capture error:", error);
      }

      // Schedule next capture with dynamic interval
      const adaptiveInterval = this.calculateAdaptiveInterval();
      const nextInterval = Math.max(
        adaptiveInterval,
        1000 / this.quality.fps
      );
      setTimeout(captureFrame, nextInterval);
    };

    captureFrame();
  }

  private calculateAdaptiveInterval(): number {
    let baseInterval = this.MIN_FRAME_INTERVAL;
    
    // Increase interval for high resolution displays
    if (this.screenSize.width >= 3840) { // 4K+
      baseInterval = Math.max(this.MIN_FRAME_INTERVAL, 50); // ~20fps max for 4K+
    } else if (this.screenSize.width >= 2560) { // QHD+
      baseInterval = Math.max(this.MIN_FRAME_INTERVAL, 40); // ~25fps max for QHD+
    }
    
    // Further increase under memory pressure
    if (this.memoryPressure) {
      baseInterval *= 1.5;
    }
    
    // Adjust based on processing performance
    const avgProcessingTime = this.getAverageProcessingTime();
    if (avgProcessingTime > baseInterval * 0.7) {
      baseInterval = Math.max(baseInterval, avgProcessingTime * 1.2);
    }
    
    return baseInterval;
  }

  private calculateFrameHash(buffer: Buffer): string {
    // Sample 32 points across the frame for quick comparison
    const samples = new Uint8Array(32);
    const step = Math.floor(buffer.length / 32);
    const offset = Math.floor(step / 2);

    for (let i = 0; i < 32; i++) {
      samples[i] = buffer[offset + i * step];
    }

    return crypto.createHash("md5").update(samples).digest("hex");
  }

  private async handleNewFrame(frame: Buffer) {
    const frameHash = this.calculateFrameHash(frame);
    if (frameHash === this.lastFrameHash) {
      this.droppedFrames++;
      return;
    }

    this.lastFrameHash = frameHash;
    this.pendingFrames.push(frame);

    // Start coalescing timer if not already running
    if (!this.coalesceTimer) {
      this.coalesceTimer = setTimeout(() => {
        this.processCoalescedFrames();
      }, this.COALESCE_MAX_WAIT);
    }
  }

  private async processCoalescedFrames() {
    if (this.pendingFrames.length === 0 || this.processingFrame) return;

    this.processingFrame = true;
    this.coalesceTimer = null;

    // Process most recent frame
    const frame = this.pendingFrames[this.pendingFrames.length - 1];
    this.pendingFrames = [];

    try {
      const startTime = performance.now();
      const processedFrame = await this.processFrame(frame);
      const processingTime = performance.now() - startTime;

      this.updatePerformanceMetrics(processingTime);
      this.adjustQualityIfNeeded();

      this.framesSent++;
      this.lastFrameSentTime = performance.now();
      this.lastFrameSize = processedFrame.length;
      
      // Update memory tracking
      this.updateMemoryUsage(processedFrame.length);
      
      // Check if frame needs chunking
      const frameSizeKB = processedFrame.length / 1024;
      if (frameSizeKB > this.currentProfile.maxFrameSize) {
        // Send as chunks
        const chunkedFrame = this.createChunkedFrame(processedFrame);
        this.subscribers.forEach((cb) => cb(chunkedFrame, this.cachedDimensions));
      } else {
        // Send as single frame
        this.subscribers.forEach((cb) => cb(processedFrame, this.cachedDimensions));
      }
      
      // Clean up memory tracking after a delay
      setTimeout(() => {
        this.updateMemoryUsage(processedFrame.length, false);
      }, 1000);
    } catch (error) {
      console.error("Frame processing error:", error);
    } finally {
      this.processingFrame = false;

      // Process any frames that arrived during processing
      if (this.pendingFrames.length > 0) {
        const adaptiveDelay = Math.min(this.COALESCE_MAX_WAIT, this.calculateAdaptiveInterval());
        this.coalesceTimer = setTimeout(() => {
          this.processCoalescedFrames();
        }, adaptiveDelay);
      }
    }
  }

  private createChunkedFrame(frame: Buffer): { chunks: Buffer[], total: number, dimensions: { width: number; height: number } } {
    const chunks: Buffer[] = [];
    const totalSize = frame.length;
    
    for (let offset = 0; offset < totalSize; offset += this.CHUNK_SIZE) {
      const end = Math.min(offset + this.CHUNK_SIZE, totalSize);
      chunks.push(frame.subarray(offset, end));
    }
    
    console.debug(`Chunking large frame: ${(totalSize / 1024).toFixed(1)}KB into ${chunks.length} chunks`);
    
    return {
      chunks,
      total: chunks.length,
      dimensions: this.cachedDimensions
    };
  }

  private async processFrame(frame: Buffer): Promise<Buffer> {
    const image = await jimp.createImage(frame);

    // Resize if needed
    if (image.width !== this.cachedDimensions.width || 
        image.height !== this.cachedDimensions.height) {
      const resizeMode = this.isProcessingSlow()
        ? ResizeStrategy.NEAREST_NEIGHBOR  // Faster but lower quality
        : ResizeStrategy.BILINEAR;         // Better quality

      image.resize({
        w: this.cachedDimensions.width,
        h: this.cachedDimensions.height,
        mode: resizeMode,
      });
    }

    // Adjust quality based on motion
    const quality = this.detectHighMotion()
      ? Math.max(this.MIN_QUALITY, this.quality.jpegQuality - 10)
      : this.quality.jpegQuality;

    return image.getBuffer("image/jpeg", {
      quality,
      progressive: false,
      chromaSubsampling: true,
      fastEntropy: true,
    });
  }

  private updatePerformanceMetrics(processingTime: number) {
    this.frameProcessingTimes.push(processingTime);
    if (this.frameProcessingTimes.length > 30) {
      this.frameProcessingTimes.shift();
    }
  }

  private detectHighMotion(): boolean {
    if (this.frameProcessingTimes.length < 5) return false;
    const recentTimes = this.frameProcessingTimes.slice(-5);
    const avgTime = recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length;
    return avgTime > this.MIN_FRAME_INTERVAL * 0.7;
  }

  private isProcessingSlow(): boolean {
    const avgTime = this.getAverageProcessingTime();
    return avgTime > this.MIN_FRAME_INTERVAL * 0.8;
  }

  private getAverageProcessingTime(): number {
    if (this.frameProcessingTimes.length === 0) return 0;
    return (
      this.frameProcessingTimes.reduce((a, b) => a + b, 0) /
      this.frameProcessingTimes.length
    );
  }

  private adjustQualityIfNeeded() {
    const now = Date.now();
    if (now - this.lastPerformanceCheck < this.PERFORMANCE_CHECK_INTERVAL) return;

    const avgProcessingTime = this.getAverageProcessingTime();
    const dropRate = this.droppedFrames / (this.droppedFrames + this.framesSent + 1);
    const memoryPressureMultiplier = this.memoryPressure ? 1.5 : 1.0;

    // More aggressive quality reduction for high-resolution displays
    const isHighRes = this.screenSize.width >= 3840; // 4K+
    const qualityReductionStep = isHighRes ? 8 : 5;
    const qualityImprovementStep = isHighRes ? 2 : 1;
    const widthReductionStep = isHighRes ? 192 : 128;
    const widthImprovementStep = isHighRes ? 64 : 64;

    if (dropRate > 0.15 * memoryPressureMultiplier || 
        avgProcessingTime > this.calculateAdaptiveInterval() * 0.8 ||
        this.memoryPressure) {
      // Reduce quality more aggressively when dropping frames or under memory pressure
      this.quality.jpegQuality = Math.max(
        this.MIN_QUALITY,
        this.quality.jpegQuality - qualityReductionStep
      );
      this.quality.width = Math.max(
        this.MIN_WIDTH,
        this.quality.width - widthReductionStep
      );
      this.cachedDimensions = this.getScaledDimensions();
      
      console.debug(`Quality reduced: width=${this.quality.width}, quality=${this.quality.jpegQuality} (drop rate: ${(dropRate * 100).toFixed(1)}%, memory pressure: ${this.memoryPressure})`);
    } 
    else if (dropRate < 0.05 && avgProcessingTime < this.calculateAdaptiveInterval() * 0.5 && !this.memoryPressure) {
      // Gradually improve quality when performance is good and no memory pressure
      this.quality.jpegQuality = Math.min(
        this.MAX_QUALITY,
        this.quality.jpegQuality + qualityImprovementStep
      );
      this.quality.width = Math.min(
        this.currentProfile.defaultWidth, // Don't exceed profile default
        this.quality.width + widthImprovementStep
      );
      this.cachedDimensions = this.getScaledDimensions();
    }

    this.lastPerformanceCheck = now;
  }

  private getScaledDimensions() {
    const { width } = this.quality;
    const { width: realWidth, height: realHeight } = this.screenSize;
    const height = Math.floor(width * (realHeight / realWidth));
    return { width, height };
  }

  public updateQualitySettings(quality: Partial<VNCQualitySettings>) {
    let changed = false;

    if (quality.width !== undefined && 
        quality.width >= this.MIN_WIDTH && 
        quality.width <= this.MAX_WIDTH && 
        quality.width !== this.quality.width) {
      this.quality.width = quality.width;
      this.cachedDimensions = this.getScaledDimensions();
      changed = true;
    }

    if (quality.jpegQuality !== undefined && 
        quality.jpegQuality >= this.MIN_QUALITY && 
        quality.jpegQuality <= this.MAX_QUALITY && 
        quality.jpegQuality !== this.quality.jpegQuality) {
      this.quality.jpegQuality = quality.jpegQuality;
      changed = true;
    }

    if (quality.fps !== undefined && 
        quality.fps >= 1 && 
        quality.fps <= 60 && 
        quality.fps !== this.quality.fps) {
      this.quality.fps = quality.fps;
      changed = true;
    }

    if (changed) {
      this.resetPerformanceMetrics();
    }
  }

  private resetPerformanceMetrics() {
    this.frameProcessingTimes = [];
    this.lastPerformanceCheck = Date.now();
    this.droppedFrames = 0;
    this.framesSent = 0;
  }

  private stopCaptureLoop() {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    if (this.coalesceTimer) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    this.isCapturing = false;
    this.lastFrameHash = null;
    this.pendingFrames = [];
    this.resetPerformanceMetrics();
  }

  public getQualitySettings(): VNCQualitySettings {
    return { ...this.quality };
  }

  public getResolutionInfo() {
    return {
      profile: this.currentProfile.name,
      screenSize: this.screenSize,
      currentSettings: this.quality,
      memoryUsage: (this.totalMemoryUsed / (1024 * 1024)).toFixed(1) + 'MB',
      memoryPressure: this.memoryPressure
    };
  }
}

/**
 * Per-connection class that handles the WebSocket for:
 * - Sending frames as Base64 (to maintain existing client contracts)
 * - Handling user input
 * - Handling commands
 */
class VSCodeVNCConnection {
  private unsubscribe: (() => void) | null = null;
  private screenSize = robot.getScreenSize();

  constructor(private ws: WebSocket) {
    this.setupWebSocketHandlers();
    this.subscribeToFrameUpdates();
  }

  private setupWebSocketHandlers() {
    this.ws.on("message", async (message: WebSocket.Data) => {
      if (message instanceof Buffer) {
        await this.handleBufferMessage(message);
      } else if (typeof message === "string") {
        await this.handleStringMessage(message);
      }
    });

    this.ws.on("close", () => {
      this.dispose();
    });
  }

  private async handleBufferMessage(message: Buffer) {
    const messageData = message.toString();
    try {
      const parsedMessage = JSON.parse(messageData);
      switch (parsedMessage.type) {
        case "mouse-event":
          await this.handleMouseEvent(parsedMessage);
          break;
        case "keyboard-event":
          await this.handleKeyboardEvent(parsedMessage);
          break;
        case "quality-update":
          ScreenCaptureManager.getInstance().updateQualitySettings(
            parsedMessage
          );
          break;
        default:
          if (this.isSupportedCommand(messageData)) {
            await handleCommand(messageData as never, this.ws);
          } else {
            await handleFileUpload(message, this.ws);
          }
      }
    } catch (error) {
      // If not JSON or parse error, treat as command or file
      if (this.isSupportedCommand(messageData)) {
        await handleCommand(messageData as never, this.ws);
      } else {
        await handleFileUpload(message, this.ws);
      }
    }
  }

  private async handleStringMessage(message: string) {
    try {
      const parsedMessage = JSON.parse(message);
      if (parsedMessage.type === "quality-update") {
        ScreenCaptureManager.getInstance().updateQualitySettings(parsedMessage);
        return;
      }
      // If not recognized JSON, treat it as text for AI chat
      throw new Error("Not recognized JSON");
    } catch {
      // Chat with OpenAI fallback
      try {
        const response = await chatWithOpenAI(
          message,
          store.getState().apiKey || ""
        );
        store.getState().webview.panel?.webview.postMessage({
          type: "chatResponse",
          response,
        });
      } catch (error: any) {
        store.getState().webview.panel?.webview.postMessage({
          type: "error",
          message: "Error chatting with AI",
        });
      }
    }
  }

  private subscribeToFrameUpdates() {
    const manager = ScreenCaptureManager.getInstance();
    // Subscribe to frames as they arrive (single frames or chunked)
    this.unsubscribe = manager.subscribe((frameData, dimensions) => {
      if (Buffer.isBuffer(frameData)) {
        // Single frame - convert to Base64
        const base64Image = frameData.toString("base64");
        this.ws.send(
          JSON.stringify({
            type: "screen-update",
            image: base64Image,
            dimensions,
          })
        );
      } else {
        // Chunked frame
        const { chunks, total } = frameData;
        
        // Send chunks sequentially
        chunks.forEach((chunk, index) => {
          const base64Chunk = chunk.toString("base64");
          this.ws.send(
            JSON.stringify({
              type: "screen-update-chunk",
              chunk: base64Chunk,
              chunkIndex: index,
              totalChunks: total,
              dimensions,
              isLastChunk: index === total - 1
            })
          );
        });
      }
    });
  }

  private getScaledDimensions() {
    const { width } = ScreenCaptureManager.getInstance()["quality"];
    const { width: realWidth, height: realHeight } = this.screenSize;
    const height = Math.floor(width * (realHeight / realWidth));
    return { width, height };
  }

  private async handleMouseEvent(data: any) {
    try {
      const { x, y, eventType, screenWidth, screenHeight } = data;

      // Convert from client space to actual screen coordinates
      const actualX = Math.floor((x / screenWidth) * this.screenSize.width);
      const actualY = Math.floor((y / screenHeight) * this.screenSize.height);

      robot.moveMouse(actualX, actualY);

      switch (eventType) {
        case "down":
          robot.mouseToggle("down", "left");
          break;
        case "up":
          robot.mouseToggle("up", "left");
          break;
        case "move":
          // Already moved above
          break;
      }
    } catch (error) {
      console.error("Error handling mouse event:", error);
    }
  }

  private async handleKeyboardEvent(data: any) {
    try {
      const { key, modifier } = data;
      if (modifier) {
        robot.keyTap(key, modifier);
      } else {
        robot.keyTap(key);
      }
    } catch (error) {
      console.error("Error handling keyboard event:", error);
    }
  }

  private isSupportedCommand(command: string): boolean {
    return (
      Object.keys(Commands)
        .map((e) => e.toLowerCase())
        .includes(command.toLowerCase()) ||
      [
        "type ",
        "keytap ",
        "go to line",
        "open file",
        "search",
        "replace",
        "@cline",
      ].some((prefix) => command.toLowerCase().startsWith(prefix))
    );
  }

  public dispose() {
    // Unsubscribe from frame updates
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

// Entry point for new WebSocket connections
export function handleWebSocketConnection(ws: WebSocket) {
  console.log("New WebSocket connection");
  addWebSocketConnection(ws);

  // Create a connection instance for this socket
  const vncConnection = new VSCodeVNCConnection(ws);

  ws.on("close", () => {
    vncConnection.dispose();
    removeWebSocketConnection(ws);
  });
}
