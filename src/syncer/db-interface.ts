export interface DbEntry {
    offer: string,
    seller: string,
    title: string,
    price: string,
    category: string,
    shipsFrom: string,
    bought: boolean,
    buyer?: string
}
