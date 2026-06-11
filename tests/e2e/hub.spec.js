// E2E: the GameClawd hub — capsules render from the registry, the machine
// reports healthy, and grabbing a capsule launches its game.

import { test, expect } from '@playwright/test'

test.describe('hub', () => {
  test('renders the marquee and a capsule per registered game', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('wordmark')).toHaveText('GAMECLAWD')

    const games = await (await page.request.get('/api/games')).json()
    expect(games.games.length).toBeGreaterThanOrEqual(2)
    for (const game of games.games) {
      const card = page.getByTestId(`game-card-${game.id}`)
      await expect(card).toBeVisible()
      await expect(card).toContainText(game.title.slice(0, 12))
    }
  })

  test('reports the machine online', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('machine-status')).toContainText('machine online', { timeout: 10_000 })
  })

  test('grab-and-play launches Dungeon of Doom (claw animation path)', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('play-dungeon').click()
    // the claw rides, drops, closes, then navigates (~1.5s)
    await page.waitForURL('**/games/dungeon/', { timeout: 10_000 })
    await expect(page.locator('#menu .title')).toContainText('DUNGEON')
  })

  test('reduced-motion users navigate instantly', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto('/')
    await page.getByTestId('play-aetherwing').click()
    await page.waitForURL('**/games/aetherwing/', { timeout: 5_000 })
    await ctx.close()
  })

  test('each game links back to the hub', async ({ page }) => {
    for (const path of ['/games/dungeon/', '/games/aetherwing/']) {
      await page.goto(path)
      await page.getByTestId('hub-link').click()
      await expect(page.getByTestId('wordmark')).toHaveText('GAMECLAWD')
    }
  })
})
