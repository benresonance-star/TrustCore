import { expect, test } from "@playwright/test";

test("labels the static fixture deployment and its release evidence", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  await expect(page.getByText("Fixture preview")).toBeVisible();
  await expect(page.getByText("Fixture operator")).toBeVisible();

  await page.getByRole("button", { name: "Health", exact: true }).click();
  await expect(page.getByText("Synthetic fixture data").first()).toBeVisible();

  await page.getByRole("button", { name: "Portability" }).click();
  await expect(page.getByText("0.2H clean reconstruction gate")).toBeVisible();
  await expect(page.getByText("Passed")).toBeVisible();
});

test("exposes the candidate portability and TCAP workflows", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Portability" }).click();
  await page.getByRole("button", { name: "Verify archive" }).click();
  await expect(page.getByText("18 entries")).toBeVisible();
  await page.getByRole("button", { name: "Generate dry-run plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan ready" })).toBeVisible();

  await page.getByRole("button", { name: "App protocol" }).click();
  await page
    .getByRole("button", { name: "Generate interface protocol" })
    .click();
  await expect(
    page.getByText("Append a schema-versioned revision"),
  ).toBeVisible();
});

test("keeps access preview explicitly non-persistent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Access" }).click();
  await expect(
    page.getByText(/controls preview the policy model; nothing is persisted/i),
  ).toBeVisible();
  await page.getByRole("button", { name: "Assign access" }).click();
  await page.getByRole("button", { name: "Add preview assignment" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "No access policy was changed",
  );
});

test("runs verification and append-only recovery through the browser", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Health", exact: true }).click();
  await page.getByRole("button", { name: "Run full verification" }).click();
  await expect(page.getByRole("status")).toContainText("PASSED");

  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: "Restore" }).first().click();
  await expect(page.getByRole("status")).toContainText(
    "Restored safely as revision",
  );
});

test("requires organisation sign-in when a live deployment is unauthenticated", async ({
  page,
}) => {
  test.skip(
    process.env.TRUST_E2E_EXPECT_LIVE !== "true",
    "Set TRUST_E2E_EXPECT_LIVE=true for a protected live Control Centre.",
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Administrator sign-in" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with organisation identity" }),
  ).toBeVisible();
});
