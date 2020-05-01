export interface DbEntry {
  offer: string;
  seller: string;
  title: string;
  price: string;
  category: string;
  shipsFrom: string;
  bought: boolean;
  attachedFiles: string;
}

export interface DbUpdate {
  offer: string;
  seller?: string;
  title?: string;
  price?: string;
  category?: string;
  shipsFrom?: string;
  bought?: boolean;
  attachedFiles?: string;
}

export interface DbErase {
  offer: string;
}
