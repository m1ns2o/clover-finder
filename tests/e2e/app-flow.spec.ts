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
