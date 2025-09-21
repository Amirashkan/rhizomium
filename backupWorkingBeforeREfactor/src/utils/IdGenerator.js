// src/utils/IdGenerator.js
class IdGenerator {
  constructor() {
    this._nextId = 1;
    this._usedIds = new Set();
  }

  // Generate a new unique ID
  generate() {
    let id;
    do {
      id = String(this._nextId++);
    } while (this._usedIds.has(id));

    this._usedIds.add(id);
    return id;
  }

  // Register an existing ID (for loading from JSON)
  register(id) {
    if (typeof id === "string" || typeof id === "number") {
      const stringId = String(id);
      this._usedIds.add(stringId);

      // Update next ID if this ID is numeric and higher
      const numericId = parseInt(stringId, 10);
      if (!isNaN(numericId) && numericId >= this._nextId) {
        this._nextId = numericId + 1;
      }
    }
  }

  // Release an ID when deleting nodes
  release(id) {
    this._usedIds.delete(String(id));
  }

  // Clear all IDs (for new graphs)
  reset() {
    this._nextId = 1;
    this._usedIds.clear();
  }

  // Get collision-safe ID for duplicates/clones
  generateSimilar(baseId) {
    // For simple sequential IDs, just generate normally
    return this.generate();
  }
}

// Export singleton instance
export const idGenerator = new IdGenerator();

// Export class for testing
export { IdGenerator };
