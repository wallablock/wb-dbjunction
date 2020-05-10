interface DbObject {
  offer: string;
}

export interface DbEntry extends DbObject {
  seller: string;
  title: string;
  price: string;
  category: string;
  shipsFrom: string;
  bought: boolean;
  attachedFiles: string;
}

type OptionalDbEntry = Partial<Omit<DbEntry, "offer">>;
export interface DbUpdate extends DbObject, OptionalDbEntry {}
