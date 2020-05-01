import {
  Blockchain,
  CompletedEvent,
  CancelledEvent,
  CreatedEvent,
  ChangedEvent,
  BoughtEvent,
  BuyerRejectedEvent,
  BlockchainEvent,
} from "wb-blockchain";
import { Config } from "../config";
import { Client } from "@elastic/elasticsearch";
import { DbEntry, DbUpdate } from "./db-interface";

export function startSyncer(config: Config, dieOnFail: boolean = true) {
  new Syncer(config).start().catch((err) => {
    console.error("Fatal error syncing with the blockchain:", err);
    if (dieOnFail) {
      process.exit(1);
    }
  });
}

class Syncer {
  private blockchain: Blockchain;
  private client: Client;

  constructor(config: Config) {
    this.blockchain = new Blockchain(config.ethereumNode);
    let auth;
    if (config.elasticApiKey != null) {
      auth = {
        apiKey: config.elasticApiKey,
      };
    } else {
      auth = {
        username: "guest",
        password: "guest",
      };
    }
    this.client = new Client({
      node: config.elasticUrl,
      auth,
    });
  }

  public async start() {
    let syncedUntil = await this.getLastBlock();
    let syncUpdates = this.blockchain.resync(
      syncedUntil != null ? syncedUntil : undefined
    );

    await this.handleCreated(await syncUpdates.createdContracts);
    await this.handleChanged(await syncUpdates.changedContracts);
    await this.handleBought(await syncUpdates.boughtContracts);
    await this.handleBuyerRejected(await syncUpdates.buyerRejectedContracts);
    await this.handleDeleted(
      await syncUpdates.completedContracts,
      await syncUpdates.cancelledContracts
    );

    this.blockchain.onCreated(this.createOffer, this.deleteOffer);
    this.blockchain.onCompleted(this.deleteOffer, this.restoreFromDump);
    this.blockchain.onChanged(this.updateOffer, this.restoreFromDump);
    this.blockchain.onCancelled(this.deleteOffer, this.restoreFromDump);
    this.blockchain.onBought(this.setBought, this.unsetBought);
    this.blockchain.onBuyerRejected(this.unsetBought, this.setBought);
  }

  private async getLastBlock(): Promise<number | string | null> {
    return (
      await this.client.get({
        index: "block",
        id: "1",
      })
    ).body.lastBlock;
  }

  private async handleCreated(created: CreatedEvent[]) {
    let body = [];
    for (let event of created) {
      body.push(
        { index: { _index: "offers", _id: event.offer } },
        this.createdToDbEntry(event)
      );
    }
    const { body: response } = await this.client.bulk({
      refresh: "true",
      body,
    });
    if (response.errors) {
      this.onElasticBulkError(body, response);
    }
  }

  private async handleChanged(changed: ChangedEvent[]) {
    let body = [];
    for (let event of changed) {
      body.push(
        { index: { _index: "offers", _id: event.offer } },
        this.changedToDbUpdate(event)
      );
    }
    const { body: response } = await this.client.bulk({
      refresh: "true",
      body,
    });
    if (response.errors) {
      this.onElasticBulkError(body, response);
    }
  }

  private async handleBought(bought: BoughtEvent[]) {
    let body = [];
    for (let event of bought) {
      body.push(
        { index: { _index: "offers", _id: event.offer } },
        {
          bought: true,
          buyer: event.buyer,
        }
      );
    }
    const { body: response } = await this.client.bulk({
      refresh: "true",
      body,
    });
    if (response.errors) {
      this.onElasticBulkError(body, response);
    }
  }

  private async handleBuyerRejected(buyerRejected: BuyerRejectedEvent[]) {
    let body = [];
    for (let event of buyerRejected) {
      body.push(
        { index: { _index: "offers", _id: event.offer } },
        {
          bought: false,
          buyer: null,
        }
      );
      const { body: response } = await this.client.bulk({
        refresh: "true",
        body,
      });
      if (response.errors) {
        this.onElasticBulkError(body, response);
      }
    }
  }

  private async handleDeleted(
    completed: CompletedEvent[],
    cancelled: CancelledEvent[]
  ) {
    let body = [];
    for (let event of [...completed, ...cancelled]) {
      body.push({ delete: { _index: "offers", _id: event.offer } });
    }
    const { body: response } = await this.client.bulk({
      refresh: "true",
      body,
    });
    if (response.errors) {
      this.onElasticBulkError(body, response);
    }
  }

  /**
   * Convert a creation event to a DbEntry, without any extra property.
   * @param entry Original event
   */
  private createdToDbEntry(entry: CreatedEvent): DbEntry {
    return {
      offer: entry.offer,
      seller: entry.seller,
      title: entry.title,
      price: entry.price,
      category: entry.category,
      shipsFrom: entry.shipsFrom,
      bought: false,
      attachedFiles: "",
    };
  }

  /**
   * Convert a change event to a DbUpdate, without any extra property.
   * @param entry Original event
   */
  private changedToDbUpdate(entry: ChangedEvent): DbUpdate {
    return {
      offer: entry.offer,
      title: entry.title,
      price: entry.price,
      category: entry.category,
      shipsFrom: entry.shipsFrom,
      attachedFiles: entry.attachedFiles,
    };
  }

  private onElasticBulkError(body: any, bulkResponse: any): never {
    let erroredDocuments: any[] = [];
    // The items array has the same order of the dataset we just indexed.
    // The presence of the `error` key indicates that the operation
    // that we did for the document has failed.
    bulkResponse.items.forEach((action: any, i: any) => {
      const operation = Object.keys(action)[0];
      if (action[operation].error) {
        // If the status is 429 it means that you can retry the document,
        // otherwise it's very likely a mapping error, and you should
        // fix the document before to try it again.
        erroredDocuments.push({
          status: action[operation].status,
          error: action[operation].error,
          operation: body[i * 2],
          document: body[i * 2 + 1],
        });
      }
    });
    throw erroredDocuments;
  }

  private async restoreFromDump(event: BlockchainEvent) {
    let newEntry = await this.blockchain.dumpOffer(event.offer);
    if (newEntry == null) {
      this.failedToRevert(event.offer);
      return;
    }
    await this.client.index({
      index: "offers",
      id: event.offer,
      body: {
        doc: newEntry,
      },
    });
  }

  private async createOffer(entry: CreatedEvent) {
    await this.client.index({
      index: "offers",
      id: entry.offer,
      body: {
        doc: entry,
      },
    });
  }

  private async updateOffer(entry: ChangedEvent) {
    await this.client.update({
      index: "offers",
      id: entry.offer,
      body: {
        doc: entry,
      },
    });
  }

  private async deleteOffer(event: BlockchainEvent) {
    await this.client.delete({
      index: "offers",
      id: event.offer,
    });
  }

  private async setBought(event: BlockchainEvent) {
    await this.client.update({
      index: "offers",
      id: event.offer,
      body: {
        doc: {
          bought: true,
        },
      },
    });
  }

  private async unsetBought(event: BlockchainEvent) {
    await this.client.update({
      index: "offers",
      id: event.offer,
      body: {
        doc: {
          bought: false,
        },
      },
    });
  }

  private failedToRevert(offerId: string) {
    console.warn("Failed to revert offer", offerId);
  }
}
