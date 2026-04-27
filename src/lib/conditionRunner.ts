import { parser } from '@lezer/python'
import type {
  BranchKind,
  ComparisonOperator,
  ConditionBranch,
  ConditionExpression,
  ConditionProgram,
  LogicalOperator,
  MetricVariable,
  ParseResult,
  ProgramIssue,
  RunTrace
} from '@/types/condition'
import type { CloverMetrics } from '@/types/clover'

const variableAliases = new Map<string, MetricVariable>([
  ['잎_개수', 'leaf_count'],
  ['잎_크기', 'avg_leaf_size']
])

const variableReplacements = [
  ['leaf_count', '잎_개수'],
  ['avg_leaf_size', '잎_크기'],
  ['평균_크기', '잎_크기']
] as const

const branchPattern = /^(if|elif)\s+(.+):$/
const elsePattern = /^else\s*:$/
const resultPattern = /^(?:결과|result)\s*=\s*(['"])(.*?)\1$/

export const defaultProgramSource = `if 잎_개수 == 4 and 잎_크기 >= 70:
    결과 = "조건에 적합한 네잎클로버"
elif 잎_개수 == 4:
    결과 = "잎 개수는 맞지만 크기를 다시 확인"
else:
    결과 = "조건에 맞지 않는 클로버"`

export function localizeProgramSource(source: string): string {
  return variableReplacements.reduce((nextSource, [from, to]) => {
    return replaceIdentifier(nextSource, from, to)
  }, source).replace(/\bresult\s*=/g, '결과 =')
}

function replaceIdentifier(source: string, from: string, to: string): string {
  return source
    .split(/([\p{L}\p{N}_]+)/gu)
    .map(token => (token === from ? to : token))
    .join('')
}

export function parseConditionProgram(source: string): ParseResult {
  const issues: ProgramIssue[] = []
  const normalizedSource = source.replace(/\r\n/g, '\n').trimEnd()

  try {
    parser.parse(normalizedSource)
  } catch {
    issues.push({ line: 1, message: 'Python 문법을 확인해 주세요.' })
  }

  const lines = normalizedSource.split('\n')
  const branches: ConditionBranch[] = []
  let index = 0
  let sawElse = false

  while (index < lines.length) {
    const rawLine = lines[index] ?? ''
    const trimmed = rawLine.trim()
    const lineNumber = index + 1

    if (!trimmed) {
      index += 1
      continue
    }

    const branchMatch = trimmed.match(branchPattern)
    const elseMatch = trimmed.match(elsePattern)

    if (!branchMatch && !elseMatch) {
      issues.push({ line: lineNumber, message: '`if`, `elif`, `else`만 가지로 사용할 수 있습니다.' })
      index += 1
      continue
    }

    const kind = (elseMatch ? 'else' : branchMatch?.[1]) as BranchKind

    if (branches.length === 0 && kind !== 'if') {
      issues.push({ line: lineNumber, message: '첫 번째 가지는 반드시 `if`여야 합니다.' })
    }

    if (sawElse) {
      issues.push({ line: lineNumber, message: '`else` 뒤에는 다른 가지를 둘 수 없습니다.' })
    }

    if (kind === 'else') {
      sawElse = true
    }

    const conditionSource = kind === 'else' ? '' : branchMatch?.[2] ?? ''
    const conditionAst = kind === 'else' ? null : parseExpression(conditionSource, lineNumber, issues)
    const resultLine = lines[index + 1]
    const resultLineNumber = index + 2

    if (!resultLine || !/^\s+/.test(resultLine)) {
      issues.push({ line: resultLineNumber, message: '각 가지 아래에는 들여쓴 `결과 = "..."`가 필요합니다.' })
      index += 1
      continue
    }

    const resultMatch = resultLine.trim().match(resultPattern)
    if (!resultMatch) {
      issues.push({ line: resultLineNumber, message: '결과는 `결과 = "문장"` 형식만 사용할 수 있습니다.' })
      index += 2
      continue
    }

    branches.push({
      id: `${kind}-${branches.length + 1}`,
      kind,
      label: makeBranchLabel(kind, branches.length),
      conditionSource,
      conditionAst,
      resultText: resultMatch[2] ?? ''
    })

    index += 2
  }

  if (!branches.length) {
    issues.push({ line: 1, message: '조건문을 입력해 주세요.' })
  }

  return {
    program: issues.length ? null : { source, branches },
    issues
  }
}

export function runConditionProgram(program: ConditionProgram, metrics: CloverMetrics): RunTrace {
  const evaluations = []
  let selectedBranchId: string | null = null
  let result: string | null = null

  for (const branch of program.branches) {
    const skipped = selectedBranchId !== null
    const passed = skipped ? false : branch.kind === 'else' ? true : evaluateExpression(branch.conditionAst, metrics)

    evaluations.push({
      branchId: branch.id,
      label: branch.label,
      kind: branch.kind,
      conditionSource: branch.conditionSource,
      passed,
      skipped
    })

    if (!selectedBranchId && passed) {
      selectedBranchId = branch.id
      result = branch.resultText
    }
  }

  return { evaluations, selectedBranchId, result }
}

export function evaluateExpression(expression: ConditionExpression | null, metrics: CloverMetrics): boolean {
  if (!expression) {
    return true
  }

  if (expression.type === 'comparison') {
    return compareValues(metrics[expression.variable], expression.operator, expression.value)
  }

  if (expression.type === 'boolean') {
    return Boolean(metrics[expression.variable])
  }

  if (expression.type === 'not') {
    return !evaluateExpression(expression.expression, metrics)
  }

  if (expression.operator === 'and') {
    return evaluateExpression(expression.left, metrics) && evaluateExpression(expression.right, metrics)
  }

  return evaluateExpression(expression.left, metrics) || evaluateExpression(expression.right, metrics)
}

function parseExpression(source: string, line: number, issues: ProgramIssue[]): ConditionExpression | null {
  const orParts = splitByLogicalOperator(source, 'or')
  if (orParts.length > 1) {
    return combineLogical(orParts, 'or', line, issues)
  }

  const andParts = splitByLogicalOperator(source, 'and')
  if (andParts.length > 1) {
    return combineLogical(andParts, 'and', line, issues)
  }

  const trimmed = stripOuterParens(source.trim())

  if (trimmed.startsWith('not ')) {
    const expression = parseExpression(trimmed.slice(4), line, issues)
    return expression ? { type: 'not', expression } : null
  }

  const comparisonMatch = trimmed.match(/^([\p{L}_][\p{L}\p{N}_]*)\s*(==|!=|<=|>=|<|>)\s*(true|false|True|False|참|거짓|-?\d+(?:\.\d+)?)$/u)
  if (comparisonMatch) {
    const rawVariable = comparisonMatch[1] ?? ''
    const variable = variableAliases.get(rawVariable)

    if (!variable) {
      issues.push({ line, message: `사용할 수 없는 변수입니다: ${rawVariable}` })
      return null
    }

    return {
      type: 'comparison',
      variable,
      operator: comparisonMatch[2] as ComparisonOperator,
      value: parseLiteral(comparisonMatch[3] ?? '')
    }
  }

  const booleanMatch = trimmed.match(/^([\p{L}_][\p{L}\p{N}_]*)$/u)
  if (booleanMatch) {
    const rawVariable = booleanMatch[1] ?? ''
    const variable = variableAliases.get(rawVariable)

    if (!variable) {
      issues.push({ line, message: `사용할 수 없는 변수입니다: ${rawVariable}` })
      return null
    }

    return { type: 'boolean', variable }
  }

  issues.push({ line, message: '조건에는 변수 비교와 `and`, `or`, `not`만 사용할 수 있습니다.' })
  return null
}

function combineLogical(parts: string[], operator: LogicalOperator, line: number, issues: ProgramIssue[]): ConditionExpression | null {
  const expressions = parts.map(part => parseExpression(part, line, issues)).filter(Boolean) as ConditionExpression[]

  if (expressions.length !== parts.length || !expressions.length) {
    return null
  }

  return expressions.slice(1).reduce<ConditionExpression>((left, right) => ({
    type: 'logical',
    operator,
    left,
    right
  }), expressions[0]!)
}

function splitByLogicalOperator(source: string, operator: LogicalOperator): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  const tokens = source.split(/(\s+|\(|\))/).filter(token => token !== '')
  let cursor = 0

  for (const token of tokens) {
    const tokenStart = source.indexOf(token, cursor)
    cursor = tokenStart + token.length

    if (token === '(') {
      depth += 1
    } else if (token === ')') {
      depth = Math.max(0, depth - 1)
    } else if (depth === 0 && token === operator) {
      parts.push(source.slice(start, tokenStart).trim())
      start = tokenStart + token.length
    }
  }

  if (!parts.length) {
    return [source]
  }

  parts.push(source.slice(start).trim())
  return parts
}

function stripOuterParens(source: string): string {
  if (!source.startsWith('(') || !source.endsWith(')')) {
    return source
  }

  let depth = 0
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
      if (depth === 0 && index < source.length - 1) {
        return source
      }
    }
  }

  return stripOuterParens(source.slice(1, -1).trim())
}

function compareValues(actual: string | number | boolean | number[], operator: ComparisonOperator, expected: number | boolean): boolean {
  if (Array.isArray(actual)) {
    return false
  }

  if (operator === '==') {
    return actual === expected
  }

  if (operator === '!=') {
    return actual !== expected
  }

  if (typeof actual !== 'number' || typeof expected !== 'number') {
    return false
  }

  if (operator === '<') {
    return actual < expected
  }

  if (operator === '<=') {
    return actual <= expected
  }

  if (operator === '>') {
    return actual > expected
  }

  return actual >= expected
}

function parseLiteral(source: string): number | boolean {
  if (source === 'true' || source === 'True') {
    return true
  }

  if (source === 'false' || source === 'False') {
    return false
  }

  if (source === '참') {
    return true
  }

  if (source === '거짓') {
    return false
  }

  return Number(source)
}

function makeBranchLabel(kind: BranchKind, index: number): string {
  if (kind === 'if') {
    return 'if'
  }

  if (kind === 'else') {
    return 'else'
  }

  return `elif ${index}`
}
