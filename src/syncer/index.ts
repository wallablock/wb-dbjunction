import { Blockchain } from "wb-blockchain";
import { Config } from "../config";
import { Client } from "@elastic/elasticsearch";
import { CompletedEvent, CancelledEvent } from "wb-blockchain/dist/events";

export function startSyncer(config: Config) {
    asyncStartSyncer(config);
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

async function asyncStartSyncer(config: Config) {
    let blockchain = new Blockchain(config.ethereumNode);
    let syncedUntil = await getLastBlock();
    let syncUpdates = await blockchain.resync((syncedUntil != null) ? syncedUntil : undefined);
    // Process syncUpdates
    const client = new Client({ node: 'https://sync:wallablocksync@f90c7dc79c2b425caf77079b50ec5677.eu-central-1.aws.cloud.es.io:9243/' });

    const accepted = syncUpdates.createdContracts.flatMap(doc => [{ index: { _index: 'offers', _id : doc.offer } }, doc]);
    const { body: bulkResponse1 } = await client.bulk({ refresh: 'true', body: accepted });
    if (bulkResponse1.errors) controlDeErrores(accepted, bulkResponse1);

    const to_be_deleted: (CompletedEvent | CancelledEvent)[] =
      syncUpdates.completedContracts.concat(syncUpdates.cancelledContracts);
    const deleted = to_be_deleted.map(doc => Object.create({ delete: { _index: 'offers', _id: doc.offer }}));
    const { body: bulkResponse2 } = await client.bulk({ refresh: 'true', body: deleted});
    if (bulkResponse2.errors) controlDeErrores(deleted, bulkResponse2);

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

async function getLastBlock(): Promise<string | number | null> {
    const client = new Client({ node: 'https://sync:wallablocksync@f90c7dc79c2b425caf77079b50ec5677.eu-central-1.aws.cloud.es.io:9243/' })

    const { body } = await client.get({
        index: 'block',
        id: '1'
    })
    return body.lastblock
}

