import { Blockchain } from "wb-blockchain";
import { Config } from "../config";
import { Client } from "@elastic/elasticsearch";
import { CompletedEvent, CancelledEvent } from "wb-blockchain/dist/events";

export function startSyncer(config: Config) {
    (new Syncer(config)).start()
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
    const accepted = (await syncUpdates.createdContracts).flatMap(doc => [{ index: { _index: 'offers', _id : doc.offer } }, doc]);
    const { body: bulkResponse1 } = await this.client.bulk({ refresh: 'true', body: accepted });
    if (bulkResponse1.errors) controlDeErrores(accepted, bulkResponse1);

    const to_be_deleted: (CompletedEvent | CancelledEvent)[] =
      (await syncUpdates.completedContracts).concat(await syncUpdates.cancelledContracts);
    const deleted = to_be_deleted.map(doc => Object.create({ delete: { _index: 'offers', _id: doc.offer }}));
    const { body: bulkResponse2 } = await this.client.bulk({ refresh: 'true', body: deleted });
    if (bulkResponse2.errors) controlDeErrores(deleted, bulkResponse2);
  }

  private async getLastBlock(): Promise<number | string | null> {
    const { body: { lastBlock: lb } } = await this.client.get({
      index: 'block',
      id: '1'
    });
    return lb
  }
}

function controlDeErrores(body: any, bulkResponse: any) {

    const erroredDocuments: Array<any> = []
    // The items array has the same order of the dataset we just indexed.
    // The presence of the `error` key indicates that the operation
    // that we did for the document has failed.
    bulkResponse.items.forEach((action: any, i: any) => {
      const operation = Object.keys(action)[0]
      if (action[operation].error) {
        erroredDocuments.push({
          // If the status is 429 it means that you can retry the document,
          // otherwise it's very likely a mapping error, and you should
          // fix the document before to try it again.
          status: action[operation].status,
          error: action[operation].error,
          operation: body[i * 2],
          document: body[i * 2 + 1]
        })
      }
    })
    console.error(erroredDocuments)
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
