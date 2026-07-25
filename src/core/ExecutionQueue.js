// src/core/ExecutionQueue.js

/**
 * Priority levels for task execution
 */
export const Priority = {
  CRITICAL: 0,  // User-initiated actions, immediate feedback
  HIGH: 1,      // Important updates (parameter changes, node connections)
  NORMAL: 2,    // Regular updates (previews, computations)
  LOW: 3,       // Background tasks (cleanup, optimization)
  IDLE: 4       // Tasks to run when idle
};

/**
 * Task status
 */
export const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed'
};

/**
 * Task wrapper with metadata
 */
class Task {
  constructor(id, fn, priority = Priority.NORMAL, options = {}) {
    this.id = id;
    this.fn = fn;
    this.priority = priority;
    this.status = TaskStatus.PENDING;
    this.result = null;
    this.error = null;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedAt = null;
    this.options = {
      timeout: options.timeout || null,
      retries: options.retries || 0,
      retryDelay: options.retryDelay || 1000,
      cancelable: options.cancelable !== false,
      group: options.group || null,
      ...options
    };
    this.retryCount = 0;
    this.cancelled = false;
  }

  /**
   * Execute the task
   */
  async execute() {
    if (this.cancelled) {
      this.status = TaskStatus.CANCELLED;
      return;
    }

    this.status = TaskStatus.RUNNING;
    this.startedAt = Date.now();

    try {
      // Execute with timeout if specified
      if (this.options.timeout) {
        this.result = await this.executeWithTimeout(this.fn, this.options.timeout);
      } else {
        this.result = await this.fn();
      }

      this.status = TaskStatus.COMPLETED;
      this.completedAt = Date.now();
      return this.result;

    } catch (error) {
      this.error = error;

      // Retry if enabled
      if (this.retryCount < this.options.retries) {
        this.retryCount++;
        this.status = TaskStatus.PENDING;

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, this.options.retryDelay));

        return this.execute();
      }

      this.status = TaskStatus.FAILED;
      this.completedAt = Date.now();
      throw error;
    }
  }

  /**
   * Execute function with timeout
   */
  async executeWithTimeout(fn, timeout) {
    return Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Task ${this.id} timed out after ${timeout}ms`)), timeout)
      )
    ]);
  }

  /**
   * Cancel the task
   */
  cancel() {
    if (this.options.cancelable) {
      this.cancelled = true;
      this.status = TaskStatus.CANCELLED;
      return true;
    }
    return false;
  }

  /**
   * Get task duration
   */
  getDuration() {
    if (!this.startedAt) return 0;
    const end = this.completedAt || Date.now();
    return end - this.startedAt;
  }
}

/**
 * Execution Queue with prioritization and concurrency control
 */
export class ExecutionQueue {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 4;
    this.enablePriority = options.enablePriority !== false;
    this.enableThrottling = options.enableThrottling !== false;
    this.throttleDelay = options.throttleDelay || 16; // ~60fps

    this.tasks = new Map(); // id -> Task
    this.queue = []; // Array of task IDs
    this.running = new Set(); // Set of running task IDs
    this.groups = new Map(); // group -> Set of task IDs

    this.stats = {
      totalEnqueued: 0,
      totalCompleted: 0,
      totalCancelled: 0,
      totalFailed: 0,
      averageDuration: 0
    };

    this.isProcessing = false;
    this.lastProcessTime = 0;

    this.eventListeners = new Map(); // event -> Set of callbacks
  }

  // ============ Task Management ============

  /**
   * Enqueue a new task
   * @param {string} id - Unique task identifier
   * @param {Function} fn - Async function to execute
   * @param {number} priority - Task priority (lower = higher priority)
   * @param {Object} options - Task options
   * @returns {string} Task ID
   */
  enqueue(id, fn, priority = Priority.NORMAL, options = {}) {
    // Cancel existing task with same ID if it exists
    if (this.tasks.has(id)) {
      this.cancel(id);
    }

    const task = new Task(id, fn, priority, options);
    this.tasks.set(id, task);
    this.queue.push(id);
    this.stats.totalEnqueued++;

    // Add to group if specified
    if (task.options.group) {
      if (!this.groups.has(task.options.group)) {
        this.groups.set(task.options.group, new Set());
      }
      this.groups.get(task.options.group).add(id);
    }

    // Sort queue by priority if enabled
    if (this.enablePriority) {
      this.sortQueue();
    }

    this.emit('enqueue', { taskId: id, priority });

    // Start processing
    this.process();

    return id;
  }

  /**
   * Cancel a task
   * @param {string} id - Task ID
   * @returns {boolean} True if cancelled
   */
  cancel(id) {
    const task = this.tasks.get(id);
    if (!task) return false;

    const cancelled = task.cancel();
    if (cancelled) {
      // Remove from queue
      const index = this.queue.indexOf(id);
      if (index >= 0) {
        this.queue.splice(index, 1);
      }

      // Remove from running
      this.running.delete(id);

      // Remove from group
      if (task.options.group) {
        const group = this.groups.get(task.options.group);
        if (group) {
          group.delete(id);
          if (group.size === 0) {
            this.groups.delete(task.options.group);
          }
        }
      }

      this.stats.totalCancelled++;
      this.emit('cancel', { taskId: id });
    }

    return cancelled;
  }

  /**
   * Cancel all tasks in a group
   * @param {string} group - Group name
   * @returns {number} Number of tasks cancelled
   */
  cancelGroup(group) {
    const groupTasks = this.groups.get(group);
    if (!groupTasks) return 0;

    let count = 0;
    for (const taskId of Array.from(groupTasks)) {
      if (this.cancel(taskId)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Cancel all tasks
   */
  cancelAll() {
    for (const id of Array.from(this.tasks.keys())) {
      this.cancel(id);
    }
  }

  /**
   * Get task status
   * @param {string} id - Task ID
   * @returns {string|null} Task status
   */
  getTaskStatus(id) {
    const task = this.tasks.get(id);
    return task ? task.status : null;
  }

  /**
   * Wait for a task to complete
   * @param {string} id - Task ID
   * @returns {Promise<any>} Task result
   */
  async waitFor(id) {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    // If already completed, return result
    if (task.status === TaskStatus.COMPLETED) {
      return task.result;
    }

    if (task.status === TaskStatus.FAILED) {
      throw task.error;
    }

    if (task.status === TaskStatus.CANCELLED) {
      throw new Error(`Task ${id} was cancelled`);
    }

    // Wait for completion
    return new Promise((resolve, reject) => {
      const checkStatus = () => {
        if (task.status === TaskStatus.COMPLETED) {
          resolve(task.result);
        } else if (task.status === TaskStatus.FAILED) {
          reject(task.error);
        } else if (task.status === TaskStatus.CANCELLED) {
          reject(new Error(`Task ${id} was cancelled`));
        } else {
          setTimeout(checkStatus, 10);
        }
      };
      checkStatus();
    });
  }

  // ============ Queue Processing ============

  /**
   * Process the queue
   */
  async process() {
    if (this.isProcessing) return;

    // Throttle processing if enabled
    if (this.enableThrottling) {
      const now = Date.now();
      const timeSinceLastProcess = now - this.lastProcessTime;

      if (timeSinceLastProcess < this.throttleDelay) {
        setTimeout(() => this.process(), this.throttleDelay - timeSinceLastProcess);
        return;
      }

      this.lastProcessTime = now;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
        const taskId = this.queue.shift();
        const task = this.tasks.get(taskId);

        if (!task || task.cancelled) {
          continue;
        }

        this.running.add(taskId);
        this.emit('start', { taskId });

        // Execute task (don't await, let it run concurrently)
        task.execute()
          .then(result => {
            this.running.delete(taskId);
            this.stats.totalCompleted++;
            this.updateAverageDuration(task.getDuration());
            this.emit('complete', { taskId, result });

            // Continue processing
            this.isProcessing = false;
            this.process();
          })
          .catch(error => {
            this.running.delete(taskId);
            this.stats.totalFailed++;
            this.emit('error', { taskId, error });

            // Continue processing
            this.isProcessing = false;
            this.process();
          });
      }
    } finally {
      // If no more tasks to start, mark as not processing
      if (this.queue.length === 0 || this.running.size >= this.maxConcurrent) {
        this.isProcessing = false;
      }
    }
  }

  /**
   * Sort queue by priority
   */
  sortQueue() {
    this.queue.sort((a, b) => {
      const taskA = this.tasks.get(a);
      const taskB = this.tasks.get(b);

      if (!taskA || !taskB) return 0;

      // Sort by priority first (lower number = higher priority)
      if (taskA.priority !== taskB.priority) {
        return taskA.priority - taskB.priority;
      }

      // Then by creation time (older first)
      return taskA.createdAt - taskB.createdAt;
    });
  }

  /**
   * Update average task duration
   */
  updateAverageDuration(duration) {
    const total = this.stats.totalCompleted;
    this.stats.averageDuration =
      (this.stats.averageDuration * (total - 1) + duration) / total;
  }

  // ============ Statistics ============

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      runningCount: this.running.size,
      totalTasks: this.tasks.size,
      groupCount: this.groups.size
    };
  }

  /**
   * Get detailed task information
   */
  getTaskInfo(id) {
    const task = this.tasks.get(id);
    if (!task) return null;

    return {
      id: task.id,
      status: task.status,
      priority: task.priority,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      duration: task.getDuration(),
      retryCount: task.retryCount,
      group: task.options.group,
      error: task.error ? task.error.message : null
    };
  }

  /**
   * Get all tasks in a group
   */
  getGroupTasks(group) {
    const groupTasks = this.groups.get(group);
    if (!groupTasks) return [];

    return Array.from(groupTasks).map(id => this.getTaskInfo(id)).filter(Boolean);
  }

  // ============ Event System ============

  /**
   * Add event listener
   * @param {string} event - Event name (enqueue, start, complete, error, cancel)
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event).add(callback);
  }

  /**
   * Remove event listener
   */
  off(event, callback) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Emit event
   */
  emit(event, data) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(data);
        } catch {

        }
      }
    }
  }

  // ============ Cleanup ============

  /**
   * Clear completed tasks
   */
  clearCompleted() {
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED) {
        this.tasks.delete(id);

        // Remove from group
        if (task.options.group) {
          const group = this.groups.get(task.options.group);
          if (group) {
            group.delete(id);
            if (group.size === 0) {
              this.groups.delete(task.options.group);
            }
          }
        }
      }
    }
  }

  /**
   * Dispose of the queue
   */
  dispose() {
    this.cancelAll();
    this.tasks.clear();
    this.queue = [];
    this.running.clear();
    this.groups.clear();
    this.eventListeners.clear();
  }
}

/**
 * Global execution queue instance
 */
export const globalExecutionQueue = new ExecutionQueue({
  maxConcurrent: 4,
  enablePriority: true,
  enableThrottling: true
});
