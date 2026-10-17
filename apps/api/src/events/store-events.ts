import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export interface StoreChangedEvent {
  storeId: string;
  seq: number;
  type: string;
}

/** Bus en proceso: operaciones confirmadas → socket y cola de revisión. */
@Injectable()
export class StoreEvents {
  private readonly emitter = new EventEmitter();

  emitChanged(event: StoreChangedEvent): void {
    this.emitter.emit('store.changed', event);
  }

  onChanged(listener: (event: StoreChangedEvent) => void): () => void {
    this.emitter.on('store.changed', listener);
    return () => this.emitter.off('store.changed', listener);
  }
}
