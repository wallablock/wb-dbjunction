import {
  Blockchain,
  CompletedEvent,
  CancelledEvent,
  CreatedEvent,
  ChangedEvent,
  BoughtEvent,
  BuyerRejectedEvent,
  BlockchainEvent,
  priceToEth,
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
  private lastBlock: number | null;

  constructor(config: Config) {
    // Temporary workaround
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    this.blockchain = new Blockchain(
      config.registryContract,
      config.ethereumNode
    );
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
    this.lastBlock = null;
  }

  public async start() {
    console.log("Started");
    this.lastBlock = await this.getLastBlock();
    console.log("Last block:", this.lastBlock);
    let syncUpdates = this.blockchain.resync(
      this.lastBlock != null ? this.lastBlock : undefined
    );

    await this.handleCreated(await syncUpdates.createdContracts);
    await this.handleChanged(await syncUpdates.changedContracts);
    await this.handleBought(await syncUpdates.boughtContracts);
    await this.handleBuyerRejected(await syncUpdates.buyerRejectedContracts);
    await this.handleDeleted(
      await syncUpdates.completedContracts,
      await syncUpdates.cancelledContracts
    );

    await this.checkLastBlock(await syncUpdates.syncedToBlock);

    this.blockchain.onCreated(
      (...args) => this.createOffer(...args),
      (...args) => this.deleteOffer(...args)
    );
    this.blockchain.onCompleted(
      (...args) => this.deleteOffer(...args),
      (...args) => this.restoreFromDump(...args)
    );
    this.blockchain.onChanged(
      (...args) => this.updateOffer(...args),
      (...args) => this.restoreFromDump(...args)
    );
    this.blockchain.onCancelled(
      (...args) => this.deleteOffer(...args),
      (...args) => this.restoreFromDump(...args)
    );
    this.blockchain.onBought(
      (...args) => this.setBought(...args),
      (...args) => this.unsetBought(...args)
    );
    this.blockchain.onBuyerRejected(
      (...args) => this.unsetBought(...args),
      (...args) => this.setBought(...args)
    );
    console.log("Resync finished");
  }

  private async getLastBlock(): Promise<number | null> {
    return (
      await this.client.get({
        index: "block",
        id: "1",
      })
    ).body._source.lastBlock;
  }

  private async checkLastBlock(currBlock: number | null) {
    if (currBlock == null) {
      return;
    }
    if (this.lastBlock != null && currBlock <= this.lastBlock) {
      return;
    }
    this.lastBlock = currBlock;
    await this.updateLastBlock(currBlock);
  }

  private async updateLastBlock(lastBlock: number) {
    await this.client.update({
      index: "block",
      id: "1",
      body: {
        doc: {
          lastBlock,
        },
      },
    });
  }

  private async handleCreated(created: CreatedEvent[]) {
    console.log("RESYNC Created:", created);
    let body = [];
    if (created.length === 0) {
      return;
    }
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
    console.log("RESYNC Changed:", changed);
    let body = [];
    if (changed.length === 0) {
      return;
    }
    for (let event of changed) {
      body.push(
        { update: { _id: event.offer, _index: "offers" } },
        { doc: this.changedToDbUpdate(event) }
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
    console.log("RESYNC Bought:", bought);
    let body = [];
    if (bought.length === 0) {
      return;
    }
    for (let event of bought) {
      body.push(
        { update: { _id: event.offer, _index: "offers" } },
        {
          doc: {
            bought: true,
            buyer: event.buyer,
          },
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
    console.log("RESYNC Buyer rejected:", buyerRejected);
    let body = [];
    if (buyerRejected.length === 0) {
      return;
    }
    for (let event of buyerRejected) {
      body.push(
        { update: { _id: event.offer, _index: "offers" } },
        {
          doc: {
            bought: false,
            buyer: null,
          },
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
    console.log("RESYNC Completed:", completed);
    console.log("RESYNC Cancelled:", cancelled);
    let deleted = [...completed, ...cancelled];
    let body = [];
    if (deleted.length === 0) {
      return;
    }
    for (let event of deleted) {
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
      price: +priceToEth(entry.price),
      category: entry.category,
      shipsFrom: entry.shipsFrom,
      bought: false,
      attachedFiles: entry.attachedFiles,
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
      price: entry.price != undefined ? +priceToEth(entry.price) : undefined,
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

  private async createOffer(entry: CreatedEvent, block: number | null) {
    console.log("CALLBACK Created:", entry);
    await this.client.index({
      index: "offers",
      id: entry.offer,
      body: {
        doc: this.createdToDbEntry(entry),
      },
    });
    await this.checkLastBlock(block);
  }

  private async updateOffer(entry: ChangedEvent, block: number | null = null) {
    console.log("CALLBACK Updated:", entry);
    await this.client.update({
      index: "offers",
      id: entry.offer,
      body: {
        doc: this.changedToDbUpdate(entry),
      },
    });
    await this.checkLastBlock(block);
  }

  private async deleteOffer(
    event: BlockchainEvent,
    block: number | null = null
  ) {
    console.log("CALLBACK Deleted:", event);
    await this.client.delete({
      index: "offers",
      id: event.offer,
    });
    await this.checkLastBlock(block);
  }

  private async setBought(event: BlockchainEvent, block: number | null = null) {
    console.log("CALLBACK Bought:", event);
    await this.client.update({
      index: "offers",
      id: event.offer,
      body: {
        doc: {
          bought: true,
        },
      },
    });
    await this.checkLastBlock(block);
  }

  private async unsetBought(
    event: BlockchainEvent,
    block: number | null = null
  ) {
    console.log("CALLBACK Unbought:", event);
    await this.client.update({
      index: "offers",
      id: event.offer,
      body: {
        doc: {
          bought: false,
        },
      },
    });
    await this.checkLastBlock(block);
  }

  private failedToRevert(offerId: string) {
    console.warn("Failed to revert offer", offerId);
  }
}
