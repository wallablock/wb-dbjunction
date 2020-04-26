import { Blockchain, CompletedEvent, CancelledEvent, CreatedEvent, ChangedEvent, BoughtEvent, BuyerRejectedEvent } from "wb-blockchain";
import { Config } from "../config";
import { Client } from "@elastic/elasticsearch";
import { DbEntry, DbUpdate } from "./db-interface";

export function startSyncer(config: Config, dieOnFail: boolean = true) {
    (new Syncer(config)).start()
      .catch(err => {
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
        apiKey: config.elasticApiKey
      };
    } else {
      auth = {
        username: 'guest',
        password: 'guest'
      }
    }
    this.client = new Client({
      node: config.elasticUrl,
      auth
    });
  }

  public async start() {
    let syncedUntil = await this.getLastBlock();
    let syncUpdates = this.blockchain.resync((syncedUntil != null) ? syncedUntil : undefined);

    await this.handleCreated(await syncUpdates.createdContracts);
    await this.handleChanged(await syncUpdates.changedContracts);
    await this.handleBought(await syncUpdates.boughtContracts);
    await this.handleBuyerRejected(await syncUpdates.buyerRejectedContracts);
    await this.handleDeleted(
      await syncUpdates.completedContracts,
      await syncUpdates.cancelledContracts
    );

    //Al crearse un evento: createOffer, onRevert: completedOffer(borrar), ignoramos errores temp
    await this.blockchain.onCreated(event => {
        this.createOffer(event);
        this.completedOffer(event);
    })

    //Al completarse un evento: completedOffer, onRevert: createOfferDump(dump), ignoramos errores temp
    await this.blockchain.onCompleted(event => {
      this.completedOffer(event);
      this.createOfferDump(event);
    })

    //Al modificarse un evento: updateOffer, onRevert: 
    await this.blockchain.onChanged(event => {
      this.updateOffer(event);
      this.updateOfferDump(event);
    })

    await this.blockchain.onCancelled(event => {
      this.cancelledOffer(event);
      this.cancelledOfferDump(event);
    })

    await this.blockchain.onCancelled(event => {
      this.cancelledOffer(event);
      this.cancelledOfferDump(event);
    })

    //Al tener un evento de comprado, lo tratamos igual que un update pero con menor información. Campos (string)buyer=x y (bool)bought=true
    await this.blockchain.onBought(event => {
      this.updateOffer(event);
      this.onBoughtOfferDump(event);
    })

    //Al tener un comprador rechazado, lo tratamos igual que un update pero con menor información. Campos (string)buyer="" y (bool)bought=false
    await this.blockchain.onBuyerRejected(event => {
      this.onBuyerRejectedOffer(event);
      this.onBuyerRejectedOfferDump(event);
    })

  }

  private async getLastBlock(): Promise<number | string | null> {
    const { body: { lastBlock: lb } } = await this.client.get({
      index: 'block',
      id: '1'
    });
    return lb
  }

  private async handleCreated(created: CreatedEvent[]) {
    let body = [];
    for (let event of created) {
      body.push({ index: { _index: 'offers', _id: event.offer }}, this.createdToDbEntry(event));
    }
    const { body: response } = await this.client.bulk({ refresh: 'true', body });
    if (response.errors) {
      this.onElasticBulkError(body, response);
    }
  }

  private async handleChanged(changed: ChangedEvent[]) {
    let body = [];
    for (let event of changed) {
      body.push({ index: { _index: 'offers', _id: event.offer }}, this.changedToDbUpdate(event));
    }
    const { body: response } = await this.client.bulk({ refresh: 'true', body });
    if (response.errors) {
      this.onElasticBulkError(body, response);
    }
  }

  private async handleBought(bought: BoughtEvent[]) {
    let body = [];
    for (let event of bought) {
      body.push({ index: { _index: 'offers', _id: event.offer }}, {
        bought: true,
        buyer: event.buyer
      });
    }
    const { body: response } = await this.client.bulk({ refresh: 'true', body });
    if (response.errors) {
      this.onElasticBulkError(body, response);
    }
  }

  private async handleBuyerRejected(buyerRejected: BuyerRejectedEvent[]) {
    let body = [];
    for (let event of buyerRejected) {
      body.push({ index: { _index: 'offers', _id: event.offer }}, {
        bought: false,
        buyer: null
      })
      const { body: response } = await this.client.bulk({ refresh: 'true', body });
      if (response.errors) {
        this.onElasticBulkError(body, response);
      }
    }
  }

  private async handleDeleted(completed: CompletedEvent[], cancelled: CancelledEvent[]) {
    let body = [];
    for (let event of [...completed, ...cancelled]) {
      body.push({ delete: { _index: 'offers', _id: event.offer }});
    }
    const { body: response } = await this.client.bulk({ refresh: 'true', body });
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
      buyer: null,
      attachedFiles: ""
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
      attachedFiles: entry.attachedFiles
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
          document: body[i * 2 + 1]
        });
      }
    });
    throw erroredDocuments;
  }

  private async createOffer (entry: CreatedEvent) {

    await this.client.index({
      index: "offers",
      id: entry.offer,
      body: {
        doc : entry
    }
    })
  }

  //dumpOffer retorna la oferta directamente de blockchain. Utilizado en onRevert
  private async createOfferDump (entry: CompletedEvent) {

    let newEntry :CreatedEvent = this.blockchain.dumpOffer(entry.offer);
    await this.client.index({
      index: "offers",
      id: newEntry.offer,
      body: {
        doc : newEntry
    }
    })
  }

  private async updateOffer (entry: ChangedEvent) {

    await this.client.update({
      index: "offers",
      id: entry.offer,
      body: {
          doc : entry
      }
    })
  }

  private async updateOfferDump (entry: ChangedEvent) {

    let newEntry :CreatedEvent = this.blockchain.dumpOffer(entry.offer);
    await this.client.index({
      index: "offers",
      id: newEntry.offer,
      body: {
        doc : newEntry
    }
    })
  }

  private async completedOffer (entry: ChangedEvent) {

    await this.client.delete({
      index: "offers",
      id: entry.offer,
    })
  
    console.log("Completed.")
  
  }

  //Tiene el mismo tratamiento que completedOffer
  private async cancelledOffer (entry: ChangedEvent) {

    await this.client.delete({
      index: "offers",
      id: entry.offer,
    })
  
    console.log("Completed.")
  
  }

  //Tiene el mismo tratamiento que createOfferDump
  private async cancelledOfferDump (entry: CompletedEvent) {

    let newEntry :CreatedEvent = this.blockchain.dumpOffer(entry.offer);
    await this.client.index({
      index: "offers",
      id: newEntry.offer,
      body: {
        doc : newEntry
    }
    })
  }

  //Simplemente hacemos update de los campos necesarios y la bd hará merge de la información
  private async onBoughtOfferDump (entry: ChangedEvent) {

    await this.client.update({
      index: "offers",
      id: entry.offer,
      body: {
          doc : {
            bought:false,
            buyer: ""
          }
      }
    })
  }


  private async onBuyerRejectedOffer (entry: ChangedEvent) {

    await this.client.update({
      index: "offers",
      id: entry.offer,
      body: {
          doc : {
            bought:false,
            buyer: ""
          }
      }
    })
  }
  

  private async onBuyerRejectedOfferDump (entry: ChangedEvent) {

    let newEntry :CreatedEvent = this.blockchain.dumpOffer(entry.offer);
    await this.client.index({
      index: "offers",
      id: newEntry.offer,
      body: {
        doc : newEntry
    }
    })
  }

}






