// src/utils/RedrawTriggerLogger.js
// Long-term logging system for redraw trigger analysis over 1h sessions

export class RedrawTriggerLogger {
  constructor(options = {}) {
    this.options = {
      sessionDuration: options.sessionDuration || 3600000, // 1 hour
      logInterval: options.logInterval || 60000, // Log every minute
      maxSessions: options.maxSessions || 10, // Keep last 10 sessions
      storageKey: options.storageKey || 'redrawTriggerLogs',
      ...options
    };

    this.currentSession = null;
    this.sessions = [];
    this.logIntervalId = null;
  }

  /**
   * Start a new logging session
   */
  startSession(sessionType = 'active') {
    const session = {
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: sessionType, // 'active' or 'idle'
      startTime: performance.now(),
      endTime: null,
      duration: 0,
      logs: [],
      summary: null
    };

    this.currentSession = session;
    this.sessions.push(session);

    // Start periodic logging
    this.logIntervalId = setInterval(() => {
      this._logSnapshot();
    }, this.options.logInterval);

    console.log(`[RedrawTriggerLogger] Started ${sessionType} session: ${session.id}`);
    return session.id;
  }

  /**
   * End current session
   */
  endSession() {
    if (!this.currentSession) return;

    this.currentSession.endTime = performance.now();
    this.currentSession.duration = this.currentSession.endTime - this.currentSession.startTime;

    if (this.logIntervalId) {
      clearInterval(this.logIntervalId);
      this.logIntervalId = null;
    }

    // Generate summary
    this.currentSession.summary = this._generateSummary(this.currentSession);

    console.log(`[RedrawTriggerLogger] Ended session: ${this.currentSession.id}`);
    
    const sessionId = this.currentSession.id;
    this.currentSession = null;

    // Clean up old sessions
    this._cleanupSessions();

    // Save to storage
    this._saveToStorage();

    return sessionId;
  }

  /**
   * Log a snapshot of current state
   */
  _logSnapshot() {
    if (!this.currentSession) return;

    const detector = window.getRedrawTriggerDetector?.();
    if (!detector) return;

    const report = detector.getReport();
    const snapshot = {
      timestamp: performance.now(),
      sessionTime: performance.now() - this.currentSession.startTime,
      statistics: report.statistics,
      triggers: report.triggers.map(t => ({
        key: t.key,
        type: t.type,
        source: t.source,
        frequency: t.frequency,
        impact: t.impact,
        severity: t.severity,
        count: t.count
      })),
      activeTimers: report.activeTimers.length,
      activeObservers: report.activeObservers.length,
      activeWorkers: report.activeWorkers.length
    };

    this.currentSession.logs.push(snapshot);
  }

  /**
   * Generate summary for a session
   */
  _generateSummary(session) {
    if (session.logs.length === 0) {
      return {
        totalSnapshots: 0,
        averageRedrawRate: 0,
        peakRedrawRate: 0,
        totalTriggers: 0,
        topTriggers: []
      };
    }

    const redrawRates = session.logs.map(log => log.statistics.redrawRate || 0);
    const averageRedrawRate = redrawRates.reduce((a, b) => a + b, 0) / redrawRates.length;
    const peakRedrawRate = Math.max(...redrawRates);

    // Aggregate triggers across all snapshots
    const triggerMap = new Map();
    session.logs.forEach(log => {
      log.triggers.forEach(trigger => {
        const key = trigger.key;
        if (!triggerMap.has(key)) {
          triggerMap.set(key, {
            key: trigger.key,
            type: trigger.type,
            source: trigger.source,
            severity: trigger.severity,
            totalCount: 0,
            maxFrequency: 0,
            maxImpact: 0,
            occurrences: 0
          });
        }
        const agg = triggerMap.get(key);
        agg.totalCount += trigger.count || 0;
        agg.maxFrequency = Math.max(agg.maxFrequency, trigger.frequency || 0);
        agg.maxImpact = Math.max(agg.maxImpact, trigger.impact || 0);
        agg.occurrences++;
      });
    });

    const topTriggers = Array.from(triggerMap.values())
      .sort((a, b) => {
        // Sort by severity first, then by frequency
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
          return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return b.maxFrequency - a.maxFrequency;
      })
      .slice(0, 10);

    return {
      totalSnapshots: session.logs.length,
      averageRedrawRate,
      peakRedrawRate,
      totalTriggers: triggerMap.size,
      topTriggers,
      averageActiveTimers: session.logs.reduce((sum, log) => sum + (log.activeTimers || 0), 0) / session.logs.length,
      averageActiveObservers: session.logs.reduce((sum, log) => sum + (log.activeObservers || 0), 0) / session.logs.length,
      averageActiveWorkers: session.logs.reduce((sum, log) => sum + (log.activeWorkers || 0), 0) / session.logs.length
    };
  }

  /**
   * Clean up old sessions
   */
  _cleanupSessions() {
    // Keep only completed sessions
    const completed = this.sessions.filter(s => s.endTime !== null);
    
    // Sort by end time (newest first) and keep only maxSessions
    completed.sort((a, b) => b.endTime - a.endTime);
    this.sessions = completed.slice(0, this.options.maxSessions);
  }

  /**
   * Save sessions to localStorage
   */
  _saveToStorage() {
    try {
      const data = {
        sessions: this.sessions.filter(s => s.endTime !== null), // Only save completed sessions
        lastUpdated: Date.now()
      };
      localStorage.setItem(this.options.storageKey, JSON.stringify(data));
    } catch (error) {
      console.warn('[RedrawTriggerLogger] Failed to save to storage:', error);
    }
  }

  /**
   * Load sessions from localStorage
   */
  loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.options.storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        this.sessions = data.sessions || [];
        return this.sessions;
      }
    } catch (error) {
      console.warn('[RedrawTriggerLogger] Failed to load from storage:', error);
    }
    return [];
  }

  /**
   * Get all sessions
   */
  getSessions() {
    return this.sessions;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId) {
    return this.sessions.find(s => s.id === sessionId);
  }

  /**
   * Get combined analysis across all sessions
   */
  getCombinedAnalysis() {
    const completedSessions = this.sessions.filter(s => s.endTime !== null);
    
    if (completedSessions.length === 0) {
      return {
        totalSessions: 0,
        totalDuration: 0,
        averageRedrawRate: 0,
        topTriggers: []
      };
    }

    const totalDuration = completedSessions.reduce((sum, s) => sum + s.duration, 0);
    const averageRedrawRate = completedSessions.reduce((sum, s) => 
      sum + (s.summary?.averageRedrawRate || 0), 0) / completedSessions.length;

    // Aggregate triggers across all sessions
    const triggerMap = new Map();
    completedSessions.forEach(session => {
      if (session.summary?.topTriggers) {
        session.summary.topTriggers.forEach(trigger => {
          const key = trigger.key;
          if (!triggerMap.has(key)) {
            triggerMap.set(key, {
              key: trigger.key,
              type: trigger.type,
              source: trigger.source,
              severity: trigger.severity,
              totalCount: 0,
              maxFrequency: 0,
              maxImpact: 0,
              sessionCount: 0
            });
          }
          const agg = triggerMap.get(key);
          agg.totalCount += trigger.totalCount || 0;
          agg.maxFrequency = Math.max(agg.maxFrequency, trigger.maxFrequency || 0);
          agg.maxImpact = Math.max(agg.maxImpact, trigger.maxImpact || 0);
          agg.sessionCount++;
        });
      }
    });

    const topTriggers = Array.from(triggerMap.values())
      .sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
          return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return b.maxFrequency - a.maxFrequency;
      });

    return {
      totalSessions: completedSessions.length,
      totalDuration,
      averageRedrawRate,
      topTriggers,
      sessions: completedSessions.map(s => ({
        id: s.id,
        type: s.type,
        duration: s.duration,
        summary: s.summary
      }))
    };
  }

  /**
   * Export data for external analysis
   */
  exportData() {
    return {
      sessions: this.sessions,
      combinedAnalysis: this.getCombinedAnalysis(),
      exportTime: Date.now()
    };
  }
}

// Global instance
let globalLogger = null;

/**
 * Get or create global logger instance
 */
export function getRedrawTriggerLogger(options) {
  if (!globalLogger) {
    globalLogger = new RedrawTriggerLogger(options);
    globalLogger.loadFromStorage();
  }
  return globalLogger;
}

// Expose to window for debugging
if (typeof window !== 'undefined') {
  window.RedrawTriggerLogger = RedrawTriggerLogger;
  window.getRedrawTriggerLogger = getRedrawTriggerLogger;
}

