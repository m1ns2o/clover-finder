import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'

const referenceThreeLeafPhoto = 'KakaoTalk_Photo_2026-04-28-10-35-11.jpeg'

test('loads saved code and runs an uploaded sample image', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('clover-logic-lab:python-source', [
      'if 잎_개수 == 4 and 잎_크기 >= 60:',
      '    결과 = "저장된 코드 통과"',
      'else:',
      '    결과 = "저장된 코드 실패"'
    ].join('\n'))
  })
  await page.reload()

  await expect(page.locator('.cm-content')).toContainText('저장된 코드 통과')
  await expect(page.locator('.hint-strip span')).toHaveText(['잎_개수', '잎_크기'])
  await page.getByRole('button', { name: '실행' }).click()
  await expect(page.getByRole('button', { name: '테스트' })).toHaveCount(0)
  await page.locator('input[type="file"]').setInputFiles('public/sample-clover.svg')

  await expect(page.locator('.result-card')).toContainText('저장된 코드 통과', { timeout: 10_000 })
  await expect(page.locator('.metrics-grid')).toContainText('잎_개수')
  await expect(page.locator('.metrics-grid')).toContainText('잎_크기')
  await expect(page.locator('.leaf-marker')).toHaveCount(4)
  await expect(page.locator('.trace-list')).toContainText('True')

  await page.getByRole('button', { name: '다시 촬영하기' }).click()
  await expect(page.locator('.capture-sheet')).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('저장된 코드 통과')
  await expect(page.getByRole('button', { name: '테스트' })).toHaveCount(0)
})

test('uploads an image file and keeps the app running', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '실행' }).click()
  await page.locator('input[type="file"]').setInputFiles('public/sample-clover.svg')

  await expect(page.locator('.result-card')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.metrics-grid')).toContainText('잎_개수')
  await expect(page.locator('.leaf-marker')).toHaveCount(4)
  await expect(page.locator('.capture-sheet')).toHaveCount(0)
})

test('ignores a separated stem-shaped contour', async ({ page }) => {
  const cloverWithDetachedStem = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
      <rect width="900" height="900" fill="#fbfbf4"/>
      <g transform="translate(450 360)">
        <path d="M0 112 C-12 242 -28 370 -62 500" stroke="#4f8e48" stroke-width="58" stroke-linecap="round" fill="none"/>
        <ellipse cx="-128" cy="-108" rx="130" ry="104" transform="rotate(-34 -128 -108)" fill="#2d965e"/>
        <ellipse cx="128" cy="-112" rx="132" ry="106" transform="rotate(34 128 -112)" fill="#319e65"/>
        <ellipse cx="-132" cy="98" rx="128" ry="106" transform="rotate(31 -132 98)" fill="#35a269"/>
        <ellipse cx="134" cy="94" rx="130" ry="104" transform="rotate(-31 134 94)" fill="#2f925c"/>
        <circle cx="0" cy="0" r="42" fill="#247a4d"/>
      </g>
    </svg>
  `)

  await page.goto('/')
  await page.getByRole('button', { name: '실행' }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'clover-with-detached-stem.svg',
    mimeType: 'image/svg+xml',
    buffer: cloverWithDetachedStem
  })

  await expect(page.locator('.result-card')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.metrics-grid')).toContainText('4개')
  await expect(page.locator('.leaf-marker')).toHaveCount(4)
  const markerTops = await page.locator('.leaf-marker').evaluateAll(markers =>
    markers.map(marker => Number.parseFloat((marker as HTMLElement).style.top))
  )
  expect(Math.max(...markerTops)).toBeLessThan(72)
})

test('does not count a small leaf-gap bridge as a fourth leaf', async ({ page }) => {
  const threeLeafWithBridge = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
      <rect width="900" height="900" fill="#fbfbf4"/>
      <g transform="translate(450 460)">
        <path d="M-12 128 C-76 238 -142 334 -216 430" stroke="#5f974d" stroke-width="40" stroke-linecap="round" fill="none"/>
        <ellipse cx="-150" cy="92" rx="132" ry="108" transform="rotate(-22 -150 92)" fill="#2f8f58"/>
        <ellipse cx="116" cy="-118" rx="132" ry="108" transform="rotate(25 116 -118)" fill="#2d8c55"/>
        <ellipse cx="176" cy="146" rx="138" ry="112" transform="rotate(-20 176 146)" fill="#2b854f"/>
        <ellipse cx="-34" cy="-12" rx="42" ry="36" transform="rotate(-28 -34 -12)" fill="#4a9846"/>
      </g>
    </svg>
  `)

  await page.goto('/')
  await page.getByRole('button', { name: '실행' }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'three-leaf-with-bridge.svg',
    mimeType: 'image/svg+xml',
    buffer: threeLeafWithBridge
  })

  await expect(page.locator('.result-card')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.metrics-grid')).toContainText('3개')
  await expect(page.locator('.leaf-marker')).toHaveCount(3)
})

test('classifies the provided three-leaf reference photo as three leaves', async ({ page }) => {
  test.skip(!existsSync(referenceThreeLeafPhoto), 'reference photo is only available in the local workspace')

  await page.goto('/')
  await page.getByRole('button', { name: '실행' }).click()
  await page.locator('input[type="file"]').setInputFiles(referenceThreeLeafPhoto)

  await expect(page.locator('.result-card')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.metrics-grid')).toContainText('3개')
  await expect(page.locator('.leaf-marker')).toHaveCount(3)
})

test('handles a large uploaded image without freezing', async ({ page }) => {
  const largeCloverSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3000 3000">
      <rect width="3000" height="3000" fill="#fafaf4"/>
      <g transform="translate(1500 1420)">
        <ellipse cx="-420" cy="-360" rx="610" ry="470" fill="#2d965e"/>
        <ellipse cx="420" cy="-360" rx="610" ry="470" fill="#319e65"/>
        <ellipse cx="-410" cy="390" rx="590" ry="480" fill="#35a269"/>
        <ellipse cx="430" cy="380" rx="620" ry="470" fill="#2f925c"/>
        <circle cx="0" cy="20" r="160" fill="#247a4d"/>
        <path d="M-35 210 C-90 720 -190 1140 -260 1410" stroke="#7ca75d" stroke-width="88" stroke-linecap="round" fill="none"/>
      </g>
    </svg>
  `)

  await page.goto('/')
  await page.getByRole('button', { name: '실행' }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'large-clover.svg',
    mimeType: 'image/svg+xml',
    buffer: largeCloverSvg
  })

  await expect(page.locator('.result-card')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: '실행' })).toBeEnabled()
})
