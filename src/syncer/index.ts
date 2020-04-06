import { Blockchain, CompletedEvent, CancelledEvent, CreatedEvent, ChangedEvent } from "wb-blockchain";
import { Config } from "../config";
import { Client } from "@elastic/elasticsearch";

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
    this.client = new Client({
      node: config.elasticUrl,
      auth: {
        username: config.elasticUsername,
        password: config.elasticPassword
      }
    });
  }

  public async start() {
    let syncedUntil = await this.getLastBlock();
    let syncUpdates = this.blockchain.resync((syncedUntil != null) ? syncedUntil : undefined);

    await this.handleCreated(await syncUpdates.createdContracts);
    await this.handleChanged(await syncUpdates.changedContracts);
    await this.handleDeleted(
      await syncUpdates.completedContracts,
      await syncUpdates.cancelledContracts
    );
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
      body.push({ index: { _index: 'offers', _id: event.offer }}, event);
    }
    const { body: response } = await this.client.bulk({ refresh: 'true', body });
    if (response.errors) {
      this.onElasticBulkError(body, response)
    }
  }

  private async handleChanged(changed: ChangedEvent[]) {
    let body = [];
    for (let event of changed) {
      body.push({ index: { _index: 'offers', _id: event.offer }}, event);
    }
    const { body: response } = await this.client.bulk({ refresh: 'true', body });
    if (response.errors) {
      this.onElasticBulkError(body, response)
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
}

async function createOffer (index: string, id : string, body: any ) {

  const client = new Client({ node: 'https://sync:wallablocksync@f90c7dc79c2b425caf77079b50ec5677.eu-central-1.aws.cloud.es.io:9243/' });

  await client.index({
    index,
    id,
    body
  })

  console.log(body._source.firstname)

}

async function updateOffer (index: string, id : string, body: any ) {

  const client = new Client({ node: 'https://sync:wallablocksync@f90c7dc79c2b425caf77079b50ec5677.eu-central-1.aws.cloud.es.io:9243/' });

  await client.update({
    index,
    id,
    body
  })

  console.log(body._source.firstname)

}

async function completedOffer (index: string, id : string) {

  const client = new Client({ node: 'https://sync:wallablocksync@f90c7dc79c2b425caf77079b50ec5677.eu-central-1.aws.cloud.es.io:9243/' });

  const { body } = await client.delete({
    index,
    id,
  })

  console.log("Completed.")

}
