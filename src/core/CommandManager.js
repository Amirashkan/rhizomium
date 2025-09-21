// src/core/CommandManager.js
export class CommandManager {
  constructor(onChange) {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = onChange; // callback مثل this.onDraw
  }

  execute(command) {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = [];
    this._notify();
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (cmd) {
      cmd.undo();
      this.redoStack.push(cmd);
      this._notify();
    }
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (cmd) {
      cmd.execute();
      this.undoStack.push(cmd);
      this._notify();
    }
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  _notify() {
    if (typeof this.onChange === "function") {
      this.onChange();
    }
  }
}
