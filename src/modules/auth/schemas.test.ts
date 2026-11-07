// @vitest-environment node
import { describe, expect, it } from "vitest";

import { changePasswordSchema, fieldErrorsFrom, loginSchema, setupSchema } from "./schemas";

const validSetup = {
  name: " Lin ",
  email: "  Me@Example.COM ",
  password: "a-long-password",
  confirmPassword: "a-long-password",
};

describe("setupSchema", () => {
  it("normalises name and email", () => {
    const parsed = setupSchema.parse(validSetup);
    expect(parsed.name).toBe("Lin");
    expect(parsed.email).toBe("me@example.com");
  });

  it("reports each invalid field", () => {
    const result = setupSchema.safeParse({ name: "", email: "nope", password: "short", confirmPassword: "x" });
    expect(result.success).toBe(false);
    const errors = fieldErrorsFrom(result.error!);
    expect(Object.keys(errors ?? {}).sort()).toEqual(["confirmPassword", "email", "name", "password"]);
  });

  it("enforces the length limits", () => {
    expect(setupSchema.safeParse({ ...validSetup, password: "123456789", confirmPassword: "123456789" }).success).toBe(false);
    const long = "x".repeat(129);
    expect(setupSchema.safeParse({ ...validSetup, password: long, confirmPassword: long }).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("requires both fields", () => {
    expect(loginSchema.safeParse({ email: "me@example.com", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "me@example.com", password: "x" }).success).toBe(true);
  });
});

describe("changePasswordSchema", () => {
  it("requires a matching, different new password", () => {
    const same = changePasswordSchema.safeParse({
      currentPassword: "a-long-password",
      newPassword: "a-long-password",
      confirmPassword: "a-long-password",
    });
    expect(fieldErrorsFrom(same.error!)?.newPassword).toBeDefined();

    const mismatch = changePasswordSchema.safeParse({
      currentPassword: "old-password-1",
      newPassword: "new-password-1",
      confirmPassword: "new-password-2",
    });
    expect(fieldErrorsFrom(mismatch.error!)?.confirmPassword).toBeDefined();
  });
});
