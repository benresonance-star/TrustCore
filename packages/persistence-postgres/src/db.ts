export interface QueryResult<Row = Record<string, unknown>> { readonly rows: Row[]; readonly rowCount: number | null; }
export interface Queryable { query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>; }
export interface TransactionClient extends Queryable { release(): void; }
export interface DatabasePool extends Queryable { connect(): Promise<TransactionClient>; end(): Promise<void>; }

export async function inTransaction<T>(pool: DatabasePool, work: (client: TransactionClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
