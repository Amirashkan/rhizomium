// src/utils/RedrawTriggerAnalyzer.js
// Analysis tool to generate inventory with severity ranking

export class RedrawTriggerAnalyzer {
  constructor() {
    this.severityColors = {
      critical: '#ff4444',
      high: '#ff8800',
      medium: '#ffbb00',
      low: '#88cc00',
      info: '#888888'
    };
  }

  /**
   * Generate inventory report from detector data
   */
  generateInventory(detector, logger = null) {
    const report = detector.getReport();
    const inventory = {
      generatedAt: new Date().toISOString(),
      session: report.session,
      statistics: report.statistics,
      triggers: this._categorizeTriggers(report.triggers),
      activeResources: {
        timers: this._analyzeTimers(report.activeTimers),
        observers: this._analyzeObservers(report.activeObservers),
        workers: this._analyzeWorkers(report.activeWorkers)
      },
      recommendations: []
    };

    // Add recommendations
    inventory.recommendations = this._generateRecommendations(inventory);

    // Add historical data if logger provided
    if (logger) {
      const analysis = logger.getCombinedAnalysis();
      inventory.historical = {
        totalSessions: analysis.totalSessions,
        averageRedrawRate: analysis.averageRedrawRate,
        topTriggers: analysis.topTriggers.slice(0, 10)
      };
    }

    return inventory;
  }

  /**
   * Categorize triggers by type and severity
   */
  _categorizeTriggers(triggers) {
    const categories = {
      critical: [],
      high: [],
      medium: [],
      low: [],
      info: []
    };

    const byType = {
      timer: [],
      observer: [],
      worker: [],
      markDirty: [],
      other: []
    };

    triggers.forEach(trigger => {
      // Categorize by severity
      categories[trigger.severity] = categories[trigger.severity] || [];
      categories[trigger.severity].push(trigger);

      // Categorize by type
      const type = trigger.type || 'other';
      byType[type] = byType[type] || [];
      byType[type].push(trigger);
    });

    return {
      bySeverity: categories,
      byType,
      all: triggers
    };
  }

  /**
   * Analyze active timers
   */
  _analyzeTimers(timers) {
    if (!timers || timers.length === 0) {
      return { count: 0, details: [] };
    }

    const details = timers.map(timer => ({
      id: timer.id,
      type: timer.type,
      delay: timer.delay,
      tickCount: timer.tickCount,
      redrawCount: timer.redrawCount,
      redrawRatio: timer.tickCount > 0 ? timer.redrawCount / timer.tickCount : 0,
      age: performance.now() - timer.createdAt,
      callback: timer.callback
    }));

    // Sort by redraw ratio (timers that cause most redraws)
    details.sort((a, b) => b.redrawRatio - a.redrawRatio);

    return {
      count: timers.length,
      details,
      summary: {
        totalTicks: details.reduce((sum, t) => sum + t.tickCount, 0),
        totalRedraws: details.reduce((sum, t) => sum + t.redrawCount, 0),
        averageRedrawRatio: details.reduce((sum, t) => sum + t.redrawRatio, 0) / details.length
      }
    };
  }

  /**
   * Analyze active observers
   */
  _analyzeObservers(observers) {
    if (!observers || observers.length === 0) {
      return { count: 0, details: [] };
    }

    const details = observers.map(observer => ({
      id: observer.id,
      type: observer.type,
      callbackCount: observer.callbackCount,
      redrawCount: observer.redrawCount,
      redrawRatio: observer.callbackCount > 0 ? observer.redrawCount / observer.callbackCount : 0,
      age: performance.now() - observer.createdAt,
      callback: observer.callback
    }));

    details.sort((a, b) => b.redrawRatio - a.redrawRatio);

    return {
      count: observers.length,
      details,
      summary: {
        totalCallbacks: details.reduce((sum, o) => sum + o.callbackCount, 0),
        totalRedraws: details.reduce((sum, o) => sum + o.redrawCount, 0),
        averageRedrawRatio: details.reduce((sum, o) => sum + o.redrawRatio, 0) / details.length
      }
    };
  }

  /**
   * Analyze active workers
   */
  _analyzeWorkers(workers) {
    if (!workers || workers.length === 0) {
      return { count: 0, details: [] };
    }

    const details = workers.map(worker => ({
      id: worker.id,
      scriptURL: worker.scriptURL,
      messageCount: worker.messageCount,
      redrawCount: worker.redrawCount,
      redrawRatio: worker.messageCount > 0 ? worker.redrawCount / worker.messageCount : 0,
      age: performance.now() - worker.createdAt
    }));

    details.sort((a, b) => b.redrawRatio - a.redrawRatio);

    return {
      count: workers.length,
      details,
      summary: {
        totalMessages: details.reduce((sum, w) => sum + w.messageCount, 0),
        totalRedraws: details.reduce((sum, w) => sum + w.redrawCount, 0),
        averageRedrawRatio: details.reduce((sum, w) => sum + w.redrawRatio, 0) / details.length
      }
    };
  }

  /**
   * Generate recommendations based on analysis
   */
  _generateRecommendations(inventory) {
    const recommendations = [];

    // Check for high-frequency timers
    const criticalTriggers = inventory.triggers.bySeverity.critical || [];
    criticalTriggers.forEach(trigger => {
      if (trigger.type === 'timer') {
        recommendations.push({
          severity: 'critical',
          type: 'timer',
          issue: `High-frequency timer causing ${trigger.frequency.toFixed(2)} redraws/second`,
          source: trigger.source,
          suggestion: `Consider debouncing or increasing interval for timer: ${trigger.source}`,
          impact: `Affects ${(trigger.impact * 100).toFixed(1)}% of all redraws`
        });
      }
    });

    // Check for observer spam
    const observerTriggers = inventory.triggers.byType.observer || [];
    observerTriggers.forEach(trigger => {
      if (trigger.frequency > 5) {
        recommendations.push({
          severity: trigger.severity,
          type: 'observer',
          issue: `Observer triggering frequent redraws: ${trigger.frequency.toFixed(2)}/second`,
          source: trigger.source,
          suggestion: `Review ${trigger.type} callback - may need throttling or debouncing`,
          impact: `Affects ${(trigger.impact * 100).toFixed(1)}% of all redraws`
        });
      }
    });

    // Check for worker message spam
    const workerTriggers = inventory.triggers.byType.worker || [];
    workerTriggers.forEach(trigger => {
      if (trigger.frequency > 2) {
        recommendations.push({
          severity: trigger.severity,
          type: 'worker',
          issue: `Worker messages causing frequent redraws: ${trigger.frequency.toFixed(2)}/second`,
          source: trigger.source,
          suggestion: `Batch worker messages or debounce redraws triggered by worker`,
          impact: `Affects ${(trigger.impact * 100).toFixed(1)}% of all redraws`
        });
      }
    });

    // Check for auto-save triggers
    const autoSaveTriggers = inventory.triggers.all.filter(t => 
      t.source && (t.source.includes('autosave') || t.source.includes('save'))
    );
    if (autoSaveTriggers.length > 0) {
      const totalAutoSaveFreq = autoSaveTriggers.reduce((sum, t) => sum + t.frequency, 0);
      if (totalAutoSaveFreq > 0.1) {
        recommendations.push({
          severity: 'medium',
          type: 'autosave',
          issue: `Auto-save triggering redraws: ${totalAutoSaveFreq.toFixed(2)}/second`,
          source: 'SaveLoadManager',
          suggestion: 'Ensure auto-save operations do not trigger editor redraws',
          impact: `Affects ${(autoSaveTriggers.reduce((sum, t) => sum + t.impact, 0) * 100).toFixed(1)}% of all redraws`
        });
      }
    }

    // Check for idle redraws
    if (inventory.statistics.redrawRate > 1 && inventory.session.isIdle) {
      recommendations.push({
        severity: 'high',
        type: 'idle',
        issue: `Redraws occurring during idle state: ${inventory.statistics.redrawRate.toFixed(2)}/second`,
        source: 'Background operations',
        suggestion: 'Review background operations that trigger redraws when user is idle',
        impact: 'Wastes CPU/GPU resources during idle periods'
      });
    }

    return recommendations.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  /**
   * Generate HTML report
   */
  generateHTMLReport(inventory) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Redraw Trigger Inventory Report</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
    h1 { color: #4ec9b0; }
    h2 { color: #569cd6; margin-top: 30px; }
    .severity-critical { color: ${this.severityColors.critical}; }
    .severity-high { color: ${this.severityColors.high}; }
    .severity-medium { color: ${this.severityColors.medium}; }
    .severity-low { color: ${this.severityColors.low}; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #444; padding: 8px; text-align: left; }
    th { background: #2d2d2d; color: #4ec9b0; }
    tr:nth-child(even) { background: #252526; }
    .recommendation { margin: 10px 0; padding: 10px; border-left: 3px solid; }
    .recommendation.critical { border-color: ${this.severityColors.critical}; }
    .recommendation.high { border-color: ${this.severityColors.high}; }
    .recommendation.medium { border-color: ${this.severityColors.medium}; }
    .stat { display: inline-block; margin: 10px 20px 10px 0; }
  </style>
</head>
<body>
  <h1>Redraw Trigger Inventory Report</h1>
  <p>Generated: ${inventory.generatedAt}</p>
  
  <h2>Statistics</h2>
  <div>
    <div class="stat"><strong>Total Redraws:</strong> ${inventory.statistics.totalRedraws}</div>
    <div class="stat"><strong>Redraw Rate:</strong> ${inventory.statistics.redrawRate.toFixed(2)}/s</div>
    <div class="stat"><strong>Active Timers:</strong> ${inventory.statistics.activeTimers}</div>
    <div class="stat"><strong>Active Observers:</strong> ${inventory.statistics.activeObservers}</div>
    <div class="stat"><strong>Active Workers:</strong> ${inventory.statistics.activeWorkers}</div>
  </div>

  <h2>Triggers by Severity</h2>
  ${this._renderTriggersBySeverity(inventory.triggers.bySeverity)}

  <h2>Active Resources</h2>
  ${this._renderActiveResources(inventory.activeResources)}

  <h2>Recommendations</h2>
  ${this._renderRecommendations(inventory.recommendations)}

  ${inventory.historical ? `
  <h2>Historical Analysis</h2>
  <p>Total Sessions: ${inventory.historical.totalSessions}</p>
  <p>Average Redraw Rate: ${inventory.historical.averageRedrawRate.toFixed(2)}/s</p>
  <h3>Top Historical Triggers</h3>
  ${this._renderTriggerList(inventory.historical.topTriggers)}
  ` : ''}
</body>
</html>
    `;
    return html;
  }

  _renderTriggersBySeverity(bySeverity) {
    let html = '';
    ['critical', 'high', 'medium', 'low', 'info'].forEach(severity => {
      const triggers = bySeverity[severity] || [];
      if (triggers.length > 0) {
        html += `<h3 class="severity-${severity}">${severity.toUpperCase()} (${triggers.length})</h3>`;
        html += this._renderTriggerList(triggers);
      }
    });
    return html;
  }

  _renderTriggerList(triggers) {
    if (triggers.length === 0) return '<p>None</p>';
    
    return `
      <table>
        <tr>
          <th>Type</th>
          <th>Source</th>
          <th>Frequency (/s)</th>
          <th>Impact (%)</th>
          <th>Count</th>
        </tr>
        ${triggers.map(t => `
          <tr>
            <td>${t.type}</td>
            <td>${t.source}</td>
            <td>${t.frequency.toFixed(2)}</td>
            <td>${(t.impact * 100).toFixed(1)}</td>
            <td>${t.count}</td>
          </tr>
        `).join('')}
      </table>
    `;
  }

  _renderActiveResources(resources) {
    return `
      <h3>Timers (${resources.timers.count})</h3>
      ${resources.timers.count > 0 ? `
        <p>Total Ticks: ${resources.timers.summary.totalTicks}, 
           Total Redraws: ${resources.timers.summary.totalRedraws},
           Avg Redraw Ratio: ${(resources.timers.summary.averageRedrawRatio * 100).toFixed(1)}%</p>
      ` : '<p>None</p>'}
      
      <h3>Observers (${resources.observers.count})</h3>
      ${resources.observers.count > 0 ? `
        <p>Total Callbacks: ${resources.observers.summary.totalCallbacks},
           Total Redraws: ${resources.observers.summary.totalRedraws},
           Avg Redraw Ratio: ${(resources.observers.summary.averageRedrawRatio * 100).toFixed(1)}%</p>
      ` : '<p>None</p>'}
      
      <h3>Workers (${resources.workers.count})</h3>
      ${resources.workers.count > 0 ? `
        <p>Total Messages: ${resources.workers.summary.totalMessages},
           Total Redraws: ${resources.workers.summary.totalRedraws},
           Avg Redraw Ratio: ${(resources.workers.summary.averageRedrawRatio * 100).toFixed(1)}%</p>
      ` : '<p>None</p>'}
    `;
  }

  _renderRecommendations(recommendations) {
    if (recommendations.length === 0) return '<p>No recommendations</p>';
    
    return recommendations.map(rec => `
      <div class="recommendation ${rec.severity}">
        <strong>[${rec.severity.toUpperCase()}] ${rec.type}</strong><br>
        <strong>Issue:</strong> ${rec.issue}<br>
        <strong>Source:</strong> ${rec.source}<br>
        <strong>Suggestion:</strong> ${rec.suggestion}<br>
        <strong>Impact:</strong> ${rec.impact}
      </div>
    `).join('');
  }

  /**
   * Generate JSON report
   */
  generateJSONReport(inventory) {
    return JSON.stringify(inventory, null, 2);
  }
}

// Expose to window
if (typeof window !== 'undefined') {
  window.RedrawTriggerAnalyzer = RedrawTriggerAnalyzer;
}

