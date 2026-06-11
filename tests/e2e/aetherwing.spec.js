// E2E: AETHERWING on the platform — the world renders, a flap starts the
// flight, and the leaderboard session/scores API answers from its new home.

import { test, expect } from '@playwright/test'

test.describe('aetherwing', () => {
  test('menu renders over a live WebGL canvas', async ({ page }) => {
    await page.goto('/games/aetherwing/')
    await expect(page.locator('#menu .title')).toContainText('AETHER')
    await expect(page.locator('canvas#game')).toBeVisible()
  })

  test('a flap starts the flight and the score HUD appears', async ({ page }) => {
    await page.goto('/games/aetherwing/')
    await expect(page.locator('#menu')).toBeVisible()
    await page.keyboard.press('Space')
    await expect(page.locator('#score')).not.toHaveClass(/hidden/, { timeout: 10_000 })
    await expect(page.locator('#menu')).toBeHidden()
  })

  test('mints a flight token from the platform API at takeoff', async ({ page }) => {
    await page.goto('/games/aetherwing/')
    await expect(page.locator('#menu')).toBeVisible()
    const session = page.waitForResponse(r =>
      r.url().includes('/api/aetherwing/session') && r.request().method() === 'POST')
    await page.keyboard.press('Space') // takeoff mints the token
    const resp = await session
    expect(resp.ok()).toBeTruthy()
    const { token } = await resp.json()
    expect(token).toMatch(/^\d+\.[0-9a-f]{32}\.[0-9a-f]{64}$/)
  })

  test('leaderboard reads come back from /api/aetherwing/scores', async ({ page }) => {
    const scores = page.waitForResponse(r =>
      r.url().includes('/api/aetherwing/scores') && r.request().method() === 'GET')
    await page.goto('/games/aetherwing/')
    expect((await scores).ok()).toBeTruthy()
  })
})
