import type { UiDocument } from '@sutra/contracts';

import {
  applyCommand,
  dispatchCommand,
  type CommandEnvelope,
  type DocumentCommand,
} from './commands';

interface HistoryEntry {
  before: UiDocument;
  after: UiDocument;
  command: DocumentCommand;
  coalesceKey: string | null;
  timestamp: number;
}

export interface DocumentHistoryOptions {
  maxEntries?: number;
  coalesceWindowMs?: number;
  validate?: (document: UiDocument) => void;
}

function coalesceKey(command: DocumentCommand): string | null {
  switch (command.kind) {
    case 'setProp':
      return `prop:${command.nodeId}:${command.propName}`;
    case 'setEvent':
      return `event:${command.nodeId}:${command.eventName}`;
    case 'setStyleProperty':
      return `style:${command.nodeId}:${command.property}`;
    case 'renameNode':
      return `name:${command.nodeId}`;
    case 'setClassRefs':
      return `classes:${command.nodeId}`;
    default:
      return null;
  }
}

export class DocumentHistory {
  #document: UiDocument;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  readonly #maxEntries: number;
  readonly #coalesceWindowMs: number;
  readonly #validate: ((document: UiDocument) => void) | undefined;

  constructor(document: UiDocument, options: DocumentHistoryOptions = {}) {
    options.validate?.(document);
    this.#document = structuredClone(document);
    this.#maxEntries = options.maxEntries ?? 250;
    this.#coalesceWindowMs = options.coalesceWindowMs ?? 650;
    this.#validate = options.validate;
  }

  get document(): UiDocument {
    return this.#document;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  dispatch(command: DocumentCommand): UiDocument {
    const before = structuredClone(this.#document);
    const result = applyCommand(this.#document, command);
    return this.#commit(before, command, result.document);
  }

  dispatchEnvelope(envelope: CommandEnvelope): UiDocument {
    const before = structuredClone(this.#document);
    const result = dispatchCommand(this.#document, envelope);
    return this.#commit(before, envelope.command, result.document);
  }

  #commit(before: UiDocument, command: DocumentCommand, document: UiDocument): UiDocument {
    this.#validate?.(document);
    const now = Date.now();
    const key = coalesceKey(command);
    const previous = this.#undo.at(-1);
    this.#document = document;
    if (
      key &&
      previous?.coalesceKey === key &&
      now - previous.timestamp <= this.#coalesceWindowMs
    ) {
      previous.after = structuredClone(document);
      previous.command = command;
      previous.timestamp = now;
    } else {
      this.#undo.push({
        before,
        after: structuredClone(document),
        command,
        coalesceKey: key,
        timestamp: now,
      });
      if (this.#undo.length > this.#maxEntries) this.#undo.shift();
    }
    this.#redo = [];
    return this.#document;
  }

  undo(): UiDocument {
    const entry = this.#undo.pop();
    if (!entry) return this.#document;
    this.#redo.push(entry);
    this.#document = structuredClone(entry.before);
    return this.#document;
  }

  redo(): UiDocument {
    const entry = this.#redo.pop();
    if (!entry) return this.#document;
    this.#undo.push(entry);
    this.#document = structuredClone(entry.after);
    return this.#document;
  }
}
