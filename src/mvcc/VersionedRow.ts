export interface VersionedRow<T = any> {
    key: string;
    data: T;
    xmin: number;
    xmax: number | null;
  }