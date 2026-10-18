import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

async function startFresh(page: Page) {
  await page.goto('/');
  await page.fill('#ob-name', 'Test');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Start fresh/ }).click();
  await expect(page.getByText('No payments yet.')).toBeVisible();
}

test('add a payment in under 5 seconds, and it survives a reload', async ({ page }) => {
  await startFresh(page);
  const started = Date.now();
  await page.getByRole('button', { name: 'Add a payment' }).first().click();
  // Amount is focused straight away: just type.
  await page.keyboard.type('50');
  await page.getByRole('button', { name: 'Tea & Vada' }).click();
  await page.getByRole('combobox', { name: 'Where' }).fill('Ramana canteen');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect(page.getByText('₹50 added to Tea & Vada')).toBeVisible();
  expect(Date.now() - started).toBeLessThan(5_000);

  await page.reload();
  await page.goto('/transactions');
  await expect(page.getByText('Ramana canteen').first()).toBeVisible();

  // Learned place: next time the category fills itself.
  await page.getByRole('button', { name: 'Add a payment' }).first().click();
  await page.keyboard.type('20');
  await page.getByRole('combobox', { name: 'Where' }).fill('Ramana canteen');
  await expect(page.getByRole('button', { name: 'Tea & Vada', pressed: true })).toBeVisible();
});

test('import a bank statement, then Google Pay for the same days, without double counting', async ({ page }) => {
  await startFresh(page);
  await page.goto('/import');
  await page.locator('input[type=file]').setInputFiles(fixture('iob-statement.csv'));
  await expect(page.getByRole('heading', { name: /Review Indian Overseas Bank/ })).toBeVisible();
  await expect(page.getByText(/Balances check out/)).toBeVisible();
  await page.getByRole('button', { name: /^Save \d+/ }).click();
  await expect(page.getByRole('heading', { name: 'Imported.' })).toBeVisible();

  await page.goto('/import');
  await page.locator('input[type=file]').setInputFiles(fixture('gpay-activity.html'));
  await expect(page.getByRole('heading', { name: /Review Google Pay/ })).toBeVisible();
  // CSA Automobile (same UPI ref) and Srinivas S payback are already logged from the bank.
  await expect(page.getByText(/2.*already in your notebook, will be joined/)).toBeVisible();
  await expect(page.getByText(/1 cancelled or pending left out/)).toBeVisible();
  await page.getByRole('button', { name: /^Save \d+/ }).click();
  await expect(page.getByText(/2 merged with payments you already had/)).toBeVisible();

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'All time' }).click();
  await page.getByRole('searchbox', { name: 'Search payments' }).fill('CSA');
  await expect(page.getByRole('button', { name: /CSA Automobile/ })).toHaveCount(1);

  // Importing the same file again adds nothing.
  await page.goto('/import');
  await page.locator('input[type=file]').setInputFiles(fixture('iob-statement.csv'));
  await expect(page.getByText(/0.* new/)).toBeVisible();
});

test('set a category limit and see safe-to-spend', async ({ page }) => {
  await startFresh(page);
  await page.goto('/budget');
  await page.getByRole('button', { name: /Eating Out/ }).first().click();
  const amount = page.locator('#alloc-amount');
  await amount.fill('900');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('₹900', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Safe to spend today')).toBeVisible();
});
