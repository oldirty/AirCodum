# Test documentation for all current functionality

## Test Coverage Overview

This test suite provides comprehensive coverage for all VNC functionality and core features of the AirCodum extension.

### Test Categories

#### 1. Unit Tests

**ScreenCaptureManager Tests** (`websockets.ScreenCaptureManager.test.ts`)
- ✅ Resolution profile detection for all display types (8K+, 5K-6K, 4K, Ultrawide, QHD, FHD)
- ✅ Quality settings management and validation 
- ✅ Memory usage tracking and pressure detection
- ✅ Adaptive interval calculation for different resolutions
- ✅ Frame hashing and duplicate detection
- ✅ Chunked frame transmission for large frames
- ✅ Performance monitoring and metrics tracking

**VSCodeVNCConnection Tests** (`websockets.VSCodeVNCConnection.test.ts`)
- ✅ WebSocket message handling (JSON, Buffer, String)
- ✅ Mouse coordinate transformation and event processing
- ✅ Keyboard event handling with/without modifiers  
- ✅ Frame subscription and transmission (single/chunked)
- ✅ Command recognition and routing
- ✅ Error handling and graceful degradation

**Command Handler Tests** (`command-handler.test.ts`)
- ✅ Built-in VS Code command execution
- ✅ Text input and typing commands
- ✅ Key tap command handling
- ✅ Search and replace functionality
- ✅ Navigation commands (go to line, open file)
- ✅ AI chat fallback for unknown commands
- ✅ Edge case handling and error recovery

**Server Tests** (`server.test.ts`)
- ✅ HTTP server startup and configuration
- ✅ WebSocket server integration
- ✅ Server lifecycle management
- ✅ Error handling and cleanup
- ✅ State management integration

#### 2. Performance Tests (`performance.test.ts`)
- ✅ Rapid frame processing efficiency
- ✅ Memory usage stability under pressure
- ✅ Adaptive interval performance
- ✅ Chunking efficiency for large frames
- ✅ Memory leak detection
- ✅ Concurrency and race condition handling
- ✅ Quality adjustment performance
- ✅ Stress testing with sustained operations

#### 3. Integration Tests (`integration.test.ts`)  
- ✅ WebSocket to ScreenCaptureManager workflow
- ✅ Quality update propagation
- ✅ Mouse event coordinate transformation
- ✅ Server to WebSocket lifecycle
- ✅ Command handler to robot controls integration
- ✅ End-to-end resolution detection
- ✅ Memory pressure coordination
- ✅ Chunked frame transmission
- ✅ Error recovery across components

### Key Features Tested

#### Resolution-Aware VNC Optimization
- **8K+ displays**: 960px width, 70% quality, 20fps, 512KB chunk threshold
- **5K-6K displays**: 1024px width, 75% quality, 25fps, 768KB chunk threshold  
- **4K displays**: 1200px width, 80% quality, 30fps, 1MB chunk threshold
- **Ultrawide displays**: 1280px width, 82% quality, 35fps, 1MB chunk threshold
- **QHD displays**: 1440px width, 85% quality, 40fps, 1.28MB chunk threshold
- **FHD displays**: 1440px width, 85% quality, 45fps, 1.5MB chunk threshold

#### Memory Management
- **512MB memory limit** with pressure detection
- **Automatic cleanup** and leak prevention
- **Adaptive throttling** under memory pressure (1.5x frame intervals)
- **Memory usage tracking** for all frame buffers

#### Performance Optimizations  
- **Adaptive frame intervals** based on resolution (33-50ms)
- **Frame coalescing** to reduce processing overhead
- **Duplicate frame detection** using MD5 hashing
- **Quality adjustment** based on performance metrics
- **Processing time tracking** with 30-sample rolling average

#### Chunked Transmission
- **32KB chunk size** for WebSocket compatibility
- **Automatic chunking** for frames exceeding profile thresholds
- **Sequential transmission** with proper indexing
- **Chunk reconstruction** verification

### Test Execution

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage  

# Run specific test suites
npm test -- --testPathPattern=websockets.ScreenCaptureManager.test.ts
npm test -- --testPathPattern=performance.test.ts
npm test -- --testPathPattern=integration.test.ts

# Watch mode for development
npm run test:watch

# CI mode for GitHub Actions
npm run test:ci
```

### Coverage Requirements

- **80% minimum coverage** for all metrics (lines, functions, branches, statements)
- **Performance benchmarks** for frame processing and memory usage
- **Error scenarios** and recovery testing
- **Edge case validation** and boundary testing

### GitHub Actions Integration

The test suite runs automatically on:
- **Push to main/develop branches**
- **Pull requests**
- **Multiple Node.js versions** (18.x, 20.x)
- **Separate jobs** for unit tests, performance tests, and integration tests
- **Coverage reporting** to Codecov
- **Artifact uploads** for test results and build outputs

### Mock Strategy

All external dependencies are properly mocked:
- **VS Code API** - Complete workspace, window, and commands mocking
- **robotjs** - Screen size, mouse, and keyboard mocking  
- **screenshot-desktop** - Mock image capture
- **WebSocket** - EventEmitter-based mock for full lifecycle testing
- **jimp** - Image processing mocking with size/quality simulation
- **crypto** - Consistent hashing for reproducible tests

### Test Data Validation

All tests use realistic data:
- **Actual resolution profiles** matching real display specifications
- **Representative frame sizes** based on compression benchmarks
- **Performance thresholds** based on 60fps requirements
- **Memory limits** matching production configurations

This comprehensive test suite ensures the VNC functionality remains stable and performant across all supported display types and usage scenarios.