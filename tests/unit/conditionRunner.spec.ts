import { describe, expect, it } from 'vitest'
import { defaultProgramSource, localizeProgramSource, parseConditionProgram, runConditionProgram } from '@/lib/conditionRunner'
import type { CloverMetrics } from '@/types/clover'

const fourLeafMetrics: CloverMetrics = {
  leaf_count: 4,
  leaf_sizes: [100, 96, 94, 92],
  avg_leaf_size: 96,
  max_leaf_size: 100,
  min_leaf_size: 92,
  size_spread: 8,
  is_balanced: true
}

describe('conditionRunner', () => {
  it('parses and runs the default program', () => {
    const parsed = parseConditionProgram(defaultProgramSource)
    expect(parsed.issues).toEqual([])
    expect(parsed.program).not.toBeNull()

    const trace = runConditionProgram(parsed.program!, fourLeafMetrics)
    expect(trace.result).toContain('적합')
    expect(trace.evaluations[0]?.passed).toBe(true)
    expect(trace.evaluations[1]?.skipped).toBe(true)
  })

  it('selects elif when the first condition is false', () => {
    const source = `if 잎_개수 == 3:
    결과 = "세잎"
elif 잎_개수 == 4 and 잎_크기 >= 90:
    결과 = "큰 네잎"
else:
    결과 = "다른 클로버"`
    const parsed = parseConditionProgram(source)
    expect(parsed.issues).toEqual([])
    expect(runConditionProgram(parsed.program!, fourLeafMetrics).result).toBe('큰 네잎')
  })

  it('rejects unsupported Python syntax', () => {
    const parsed = parseConditionProgram(`for 크기 in 잎_크기들:
    결과 = "반복문"`)
    expect(parsed.program).toBeNull()
    expect(parsed.issues[0]?.message).toContain('if')
  })

  it('rejects unknown variables', () => {
    const parsed = parseConditionProgram(`if 행운_점수 > 10:
    결과 = "행운"`)
    expect(parsed.program).toBeNull()
    expect(parsed.issues[0]?.message).toContain('사용할 수 없는 변수')
  })

  it('only accepts the two learner-facing variables', () => {
    const parsed = parseConditionProgram(`if 평균_크기 >= 60:
    결과 = "옛 변수"`)
    expect(parsed.program).toBeNull()
    expect(parsed.issues[0]?.message).toContain('사용할 수 없는 변수')
  })

  it('localizes saved legacy code before running', () => {
    const localized = localizeProgramSource(`if leaf_count == 4 and avg_leaf_size >= 60:
    result = "legacy ok"`)
    expect(localized).toContain('잎_개수 == 4 and 잎_크기 >= 60')
    expect(localized).toContain('결과 = "legacy ok"')

    const parsed = parseConditionProgram(localized)
    expect(parsed.issues).toEqual([])
    expect(runConditionProgram(parsed.program!, fourLeafMetrics).result).toBe('legacy ok')
  })
})
