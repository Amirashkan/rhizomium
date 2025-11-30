/**
 * Device Detection Utility
 * Detects mobile devices and unsupported browsers/devices
 */

export class DeviceDetector {
  /**
   * Check if the current device is a mobile device
   * @returns {boolean}
   */
  static isMobile() {
    if (typeof window === 'undefined') return false;
    
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    
    // Check for mobile device patterns
    const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet/i;
    const isMobileDevice = mobileRegex.test(userAgent);
    
    // Also check for touch support and screen size
    const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isSmallScreen = window.innerWidth < 768;
    
    return isMobileDevice || (hasTouchScreen && isSmallScreen);
  }

  /**
   * Check if WebGPU is supported
   * @returns {Promise<boolean>}
   */
  static async isWebGPUSupported() {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      return false;
    }
    
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return adapter !== null;
    } catch (error) {
      console.warn('WebGPU adapter request failed:', error);
      return false;
    }
  }

  /**
   * Get browser name and version
   * @returns {{name: string, version: string, supported: boolean}}
   */
  static getBrowserInfo() {
    if (typeof navigator === 'undefined') {
      return { name: 'Unknown', version: '0', supported: false };
    }

    const userAgent = navigator.userAgent;
    let name = 'Unknown';
    let version = '0';
    let supported = false;

    // Chrome/Edge (Chromium-based)
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
      const match = userAgent.match(/Chrome\/(\d+)/);
      if (match) {
        name = 'Chrome';
        version = match[1];
        supported = parseInt(version) >= 113;
      }
    }
    // Edge
    else if (userAgent.includes('Edg')) {
      const match = userAgent.match(/Edg\/(\d+)/);
      if (match) {
        name = 'Edge';
        version = match[1];
        supported = parseInt(version) >= 113;
      }
    }
    // Firefox
    else if (userAgent.includes('Firefox')) {
      const match = userAgent.match(/Firefox\/(\d+)/);
      if (match) {
        name = 'Firefox';
        version = match[1];
        // Firefox has experimental WebGPU support
        supported = false; // Not fully supported yet
      }
    }
    // Safari
    else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      const match = userAgent.match(/Version\/(\d+)/);
      if (match) {
        name = 'Safari';
        version = match[1];
        // Safari has partial WebGPU support
        supported = false; // Limited support
      }
    }
    // Opera
    else if (userAgent.includes('OPR') || userAgent.includes('Opera')) {
      const match = userAgent.match(/(?:OPR|Opera)\/(\d+)/);
      if (match) {
        name = 'Opera';
        version = match[1];
        supported = parseInt(version) >= 99;
      }
    }

    return { name, version, supported };
  }

  /**
   * Get device type information
   * @returns {{type: string, isMobile: boolean, isTablet: boolean, isDesktop: boolean}}
   */
  static getDeviceType() {
    const isMobile = this.isMobile();
    const userAgent = navigator.userAgent || '';
    
    const isTablet = /ipad|tablet|android(?!.*mobile)/i.test(userAgent);
    const isDesktop = !isMobile && !isTablet;
    
    let type = 'desktop';
    if (isTablet) type = 'tablet';
    else if (isMobile) type = 'mobile';
    
    return { type, isMobile, isTablet, isDesktop };
  }

  /**
   * Check if device is supported
   * @returns {Promise<{supported: boolean, reason?: string, details: object}>}
   */
  static async checkSupport() {
    const isMobile = this.isMobile();
    const browserInfo = this.getBrowserInfo();
    const deviceType = this.getDeviceType();
    const webGPUSupported = await this.isWebGPUSupported();

    // Mobile devices are not supported
    if (isMobile) {
      return {
        supported: false,
        reason: 'mobile',
        details: {
          deviceType: deviceType.type,
          browser: browserInfo.name,
          webGPU: webGPUSupported
        }
      };
    }

    // Check WebGPU support
    if (!webGPUSupported) {
      return {
        supported: false,
        reason: 'webgpu',
        details: {
          deviceType: deviceType.type,
          browser: browserInfo.name,
          browserVersion: browserInfo.version,
          browserSupported: browserInfo.supported
        }
      };
    }

    // Check browser compatibility
    if (!browserInfo.supported) {
      return {
        supported: false,
        reason: 'browser',
        details: {
          deviceType: deviceType.type,
          browser: browserInfo.name,
          browserVersion: browserInfo.version,
          webGPU: webGPUSupported
        }
      };
    }

    return {
      supported: true,
      details: {
        deviceType: deviceType.type,
        browser: browserInfo.name,
        browserVersion: browserInfo.version,
        webGPU: webGPUSupported
      }
    };
  }
}

