import {
	AppError,
	ConflictError,
	errorMessage,
	ForbiddenError,
	isAppError,
	NotFoundError,
	StoreUnavailableError,
	UnauthorizedError,
	ValidationError,
} from "@/lib/errors";

describe("errors", () => {
	it("maps codes to http statuses", () => {
		expect(new ValidationError("bad").status).toBe(400);
		expect(new UnauthorizedError().status).toBe(401);
		expect(new ForbiddenError().status).toBe(403);
		expect(new NotFoundError("Incident", "x").status).toBe(404);
		expect(new ConflictError("dup").status).toBe(409);
		expect(new StoreUnavailableError(new Error("down")).status).toBe(503);
	});

	it("has helpful messages and names", () => {
		expect(new NotFoundError("Incident", "inc_1").message).toBe(
			'Incident "inc_1" was not found',
		);
		expect(new UnauthorizedError().message).toBe("Authentication required");
		expect(new ForbiddenError().name).toBe("ForbiddenError");
		const cause = new Error("down");
		expect(new StoreUnavailableError(cause).cause).toBe(cause);
		expect(new AppError("conflict", "x").name).toBe("AppError");
	});

	it("detects app errors and extracts messages", () => {
		expect(isAppError(new ConflictError("x"))).toBe(true);
		expect(isAppError(new Error("x"))).toBe(false);
		expect(errorMessage(new Error("boom"))).toBe("boom");
		expect(errorMessage("plain")).toBe("plain");
	});
});
