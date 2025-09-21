// src/core/commands.js

export class DeleteSelectionCommand {
  constructor(selection, connections) {
    this.selection = [...selection.graph.nodes.filter(n => n.selected)];
    this.connections = connections;
    this.removedNodes = [];
    this.removedConnections = [];
  }

  execute() {
    this.removedNodes = [];
    this.removedConnections = [];

    this.selection.forEach(node => {
      // ذخیره connections مرتبط
      const conns = this.connections.findForNode(node.id);
      this.removedConnections.push(...conns);
      conns.forEach(c => this.connections.remove(c));
      node._deleted = true;
      this.removedNodes.push(node);
    });
  }

  undo() {
    this.removedNodes.forEach(node => node._deleted = false);
    this.removedConnections.forEach(c => this.connections.add(c));
  }
}

export class MoveNodeCommand {
  constructor(node, from, to) {
    this.node = node;
    this.from = { ...from };
    this.to = { ...to };
  }

  execute() { this.node.position = { ...this.to }; }
  undo() { this.node.position = { ...this.from }; }
}

export class ConnectCommand {
  constructor(connections, fromNodeId, fromPin, toNodeId, toPin) {
    this.connections = connections;
    this.fromNodeId = fromNodeId;
    this.fromPin = fromPin;
    this.toNodeId = toNodeId;
    this.toPin = toPin;
    this.connection = null;
  }

  execute() {
    this.connection = this.connections.add({
      fromNodeId: this.fromNodeId,
      fromPin: this.fromPin,
      toNodeId: this.toNodeId,
      toPin: this.toPin
    });
  }

  undo() {
    if(this.connection) this.connections.remove(this.connection);
  }
}

export class DisconnectCommand {
  constructor(connections, connection) {
    this.connections = connections;
    this.connection = connection;
  }

  execute() { this.connections.remove(this.connection); }
  undo() { this.connections.add(this.connection); }
}

export class ParamChangeCommand {
  constructor(node, paramKey, oldValue, newValue) {
    this.node = node;
    this.paramKey = paramKey;
    this.oldValue = oldValue;
    this.newValue = newValue;
  }

  execute() { this.node.params[this.paramKey] = this.newValue; }
  undo() { this.node.params[this.paramKey] = this.oldValue; }
}

export class ExpressionChangeCommand {
  constructor(node, exprKey, oldValue, newValue) {
    this.node = node;
    this.exprKey = exprKey;
    this.oldValue = oldValue;
    this.newValue = newValue;
  }

  execute() { this.node.custom_expressions[this.exprKey] = this.newValue; }
  undo() { this.node.custom_expressions[this.exprKey] = this.oldValue; }
}
