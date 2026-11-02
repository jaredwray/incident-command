import pg from "pg";
import { PerQueryClient, PostgresStore } from "@/lib/store/postgres";

describe("PerQueryClient", () => {
	afterEach(() => vi.restoreAllMocks());

	it("opens and closes a connection around every query", async () => {
		const connect = vi
			.spyOn(pg.Client.prototype, "connect")
			.mockResolvedValue(undefined as never);
		const query = vi
			.spyOn(pg.Client.prototype, "query")
			.mockResolvedValue({ rows: [{ one: 1 }] } as never);
		const end = vi
			.spyOn(pg.Client.prototype, "end")
			.mockResolvedValue(undefined as never);
		const client = new PerQueryClient("postgres://localhost/x");
		await expect(client.query("SELECT 1 AS one", [])).resolves.toEqual({
			rows: [{ one: 1 }],
		});
		expect(connect).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledWith("SELECT 1 AS one", []);
		expect(end).toHaveBeenCalledTimes(1);
	});

	it("closes the connection when a query fails", async () => {
		vi.spyOn(pg.Client.prototype, "connect").mockResolvedValue(
			undefined as never,
		);
		vi.spyOn(pg.Client.prototype, "query").mockRejectedValue(
			new Error("syntax error") as never,
		);
		const end = vi
			.spyOn(pg.Client.prototype, "end")
			.mockResolvedValue(undefined as never);
		await expect(new PerQueryClient().query("SELEC")).rejects.toThrow(
			"syntax error",
		);
		expect(end).toHaveBeenCalledTimes(1);
	});

	it("is used by PostgresStore when pooling is disabled", async () => {
		vi.spyOn(pg.Client.prototype, "connect").mockResolvedValue(
			undefined as never,
		);
		vi.spyOn(pg.Client.prototype, "query").mockResolvedValue({
			rows: [],
		} as never);
		vi.spyOn(pg.Client.prototype, "end").mockResolvedValue(undefined as never);
		const poolEnd = vi.spyOn(pg.Pool.prototype, "end");
		const store = new PostgresStore({
			connectionString: "postgres://localhost/x",
			pool: false,
		});
		await store.ping();
		await store.disconnect();
		expect(poolEnd).not.toHaveBeenCalled();
	});
});
