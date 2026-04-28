import { expect, test } from '@playwright/test'

test('loads saved code and runs the default test image', async ({ page }) => {
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
  await page.getByRole('button', { name: '테스트' }).click()

  await expect(page.locator('.result-card')).toContainText('저장된 코드 통과', { timeout: 10_000 })
  await expect(page.locator('.metrics-grid')).toContainText('잎_개수')
  await expect(page.locator('.metrics-grid')).toContainText('잎_크기')
  await expect(page.locator('.leaf-marker')).toHaveCount(4)
  await expect(page.locator('.trace-list')).toContainText('True')
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
        <path d="M0 180 C-12 280 -28 370 -62 500" stroke="#4f8e48" stroke-width="38" stroke-linecap="round" fill="none"/>
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
