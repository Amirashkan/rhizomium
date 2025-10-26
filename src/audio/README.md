# Audio File Upload Fix

## Problem

When uploading audio files in a web application using the Web Audio API, you may encounter this error:

```
InvalidStateError: Failed to execute 'createMediaElementSource' on 'AudioContext':
HTMLMediaElement already connected previously to a different MediaElementSourceNode.
```

This occurs when trying to create a new `MediaElementSourceNode` from an `HTMLMediaElement` (like an `<audio>` tag) that has already been connected to a source node.

## Why This Happens

According to the Web Audio API specification, each `HTMLMediaElement` can only be connected to **ONE** `MediaElementSourceNode` during its entire lifetime. Once connected, you cannot create another source node from the same element, even after disconnecting.

## The Solution

### Option 1: Create a New Audio Element (Recommended)

Create a fresh `<audio>` element each time you load a new file:

```javascript
// WRONG - Reusing the same audio element
this.audioElement.src = newFileURL;
this.sourceNode = audioContext.createMediaElementSource(this.audioElement); // ERROR!

// CORRECT - Create new audio element
this.cleanup(); // Clean up old element
this.audioElement = new Audio();
this.audioElement.src = newFileURL;
this.sourceNode = audioContext.createMediaElementSource(this.audioElement); // Works!
```

### Option 2: Reuse the Same Source Node

Keep the same source node and just change the audio element's source:

```javascript
// Create source node once
if (!this.sourceNode && this.audioElement) {
  this.sourceNode = audioContext.createMediaElementSource(this.audioElement);
  this.sourceNode.connect(audioContext.destination);
}

// Change audio file
this.audioElement.src = newFileURL;
this.audioElement.load();
```

## Implementation

### BrowserAudioCapture.js

Handles audio file loading with proper cleanup:

```javascript
async loadFile(file) {
  // Clean up previous audio element and source node
  this.cleanup();

  // Create NEW audio element
  this.audioElement = new Audio();
  this.audioElement.src = URL.createObjectURL(file);

  await new Promise((resolve, reject) => {
    this.audioElement.addEventListener('canplaythrough', resolve, { once: true });
    this.audioElement.addEventListener('error', reject, { once: true });
    this.audioElement.load();
  });

  // Now create source node (element is fresh, not connected)
  this.sourceNode = this.audioContext.createMediaElementSource(this.audioElement);
  this.sourceNode.connect(this.audioContext.destination);
}

cleanup() {
  if (this.sourceNode) {
    this.sourceNode.disconnect();
    this.sourceNode = null;
  }

  if (this.audioElement) {
    this.audioElement.pause();
    this.audioElement.src = '';
    if (this.audioElement.src.startsWith('blob:')) {
      URL.revokeObjectURL(this.audioElement.src);
    }
    this.audioElement.load();
    this.audioElement = null;
  }
}
```

### AudioSettingsPanel.js

UI panel that uses BrowserAudioCapture:

```javascript
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    // This internally creates a new audio element
    await this.audioCapture.loadFile(file);
    console.log('Audio loaded successfully');
  } catch (error) {
    console.error('Failed to load audio:', error);
  }
});
```

## Key Points

1. **Memory Management**: Always revoke object URLs when done:
   ```javascript
   URL.revokeObjectURL(this.audioElement.src);
   ```

2. **Disconnect Nodes**: Disconnect audio nodes before cleanup:
   ```javascript
   this.sourceNode.disconnect();
   ```

3. **Error Handling**: Handle audio load errors gracefully:
   ```javascript
   this.audioElement.addEventListener('error', reject, { once: true });
   ```

4. **Browser Autoplay Policy**: Resume AudioContext if suspended:
   ```javascript
   if (audioContext.state === 'suspended') {
     await audioContext.resume();
   }
   ```

## Testing

To test the fix:

1. Open `examples/audio-test.html` in your browser
2. Upload an audio file
3. Upload another audio file
4. Check the browser console - no errors!

## Migration Guide

If you have existing code with this error:

### Before:
```javascript
async loadAudioFile(file) {
  this.audio.src = URL.createObjectURL(file);
  this.source = this.audioContext.createMediaElementSource(this.audio);
  // Error on second file upload!
}
```

### After:
```javascript
async loadAudioFile(file) {
  // Clean up first
  if (this.source) {
    this.source.disconnect();
    this.source = null;
  }
  if (this.audio) {
    this.audio.pause();
    URL.revokeObjectURL(this.audio.src);
    this.audio = null;
  }

  // Create fresh audio element
  this.audio = new Audio();
  this.audio.src = URL.createObjectURL(file);

  // Now create source node
  this.source = this.audioContext.createMediaElementSource(this.audio);
  this.source.connect(this.audioContext.destination);
}
```

## References

- [Web Audio API Specification - MediaElementAudioSourceNode](https://www.w3.org/TR/webaudio/#MediaElementAudioSourceNode)
- [MDN - createMediaElementSource()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource)
- [Stack Overflow - HTMLMediaElement already connected](https://stackoverflow.com/questions/tagged/web-audio-api+htmlmediaelement)
