// E2E: Dungeon of Doom on the platform — solo boots into a live 3D run,
// and two real browser contexts complete the host/join co-op handshake.

import { test, expect } from '@playwright/test'

test.describe('dungeon of doom', () => {
  test('solo run boots: canvas, HUD, and a live simulation', async ({ page }) => {
    await page.goto('/games/dungeon/')
    await expect(page.locator('#menu')).toBeVisible()

    await page.locator('#btn-solo').click()
    await expect(page.locator('#hud')).not.toHaveClass(/hidden/, { timeout: 15_000 })
    await expect(page.locator('#game-root canvas')).toBeVisible()
    // HP bar populated by the first server snapshot
    await expect(page.locator('#hp-text')).not.toHaveText('', { timeout: 10_000 })
  })

  test('menu leaderboard loads from the platform API', async ({ page }) => {
    const lbResponse = page.waitForResponse('**/api/dungeon/leaderboard')
    await page.goto('/games/dungeon/')
    expect((await lbResponse).ok()).toBeTruthy()
  })

  test('two players co-op via room code across browser contexts', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const friendCtx = await browser.newContext()
    const host = await hostCtx.newPage()
    const friend = await friendCtx.newPage()

    // host opens a lobby and reads the room code off the HUD
    await host.goto('/games/dungeon/')
    await host.locator('#btn-host').click()
    await expect(host.locator('#code-badge')).not.toHaveClass(/hidden/, { timeout: 15_000 })
    const code = (await host.locator('#code-text').textContent()).trim()
    expect(code).toMatch(/^[A-Z2-9]{4}$/)

    // friend joins with the code
    await friend.goto('/games/dungeon/')
    await friend.locator('#join-code').fill(code)
    await friend.locator('#btn-join').click()
    await expect(friend.locator('#hud')).not.toHaveClass(/hidden/, { timeout: 15_000 })
    await expect(friend.locator('#game-root canvas')).toBeVisible()

    // both clients receive authoritative snapshots (HP text populated)
    await expect(host.locator('#hp-text')).not.toHaveText('', { timeout: 10_000 })
    await expect(friend.locator('#hp-text')).not.toHaveText('', { timeout: 10_000 })

    await hostCtx.close()
    await friendCtx.close()
  })

  test('joining a nonexistent room shows a friendly error', async ({ page }) => {
    await page.goto('/games/dungeon/')
    await page.locator('#join-code').fill('XXXX')
    await page.locator('#btn-join').click()
    await expect(page.locator('#menu-error')).toContainText('No game found', { timeout: 10_000 })
  })
})
