import type { CloverMetrics } from './clover'

export type BranchKind = 'if' | 'elif' | 'else'
export type MetricVariable = keyof CloverMetrics
export type ComparisonOperator = '==' | '!=' | '<' | '<=' | '>' | '>='
export type LogicalOperator = 'and' | 'or'

export type ConditionExpression =
  | { type: 'comparison', variable: MetricVariable, operator: ComparisonOperator, value: number | boolean }
  | { type: 'boolean', variable: MetricVariable }
  | { type: 'not', expression: ConditionExpression }
  | { type: 'logical', operator: LogicalOperator, left: ConditionExpression, right: ConditionExpression }

export interface ConditionBranch {
  id: string
  kind: BranchKind
  label: string
  conditionSource: string
  conditionAst: ConditionExpression | null
  resultText: string
}

export interface ConditionProgram {
  source: string
  branches: ConditionBranch[]
}

export interface ConditionEvaluation {
  branchId: string
  label: string
  kind: BranchKind
  conditionSource: string
  passed: boolean
  skipped: boolean
}

export interface RunTrace {
  evaluations: ConditionEvaluation[]
  selectedBranchId: string | null
  result: string | null
}

export interface ProgramIssue {
  line: number
  message: string
}

export interface ParseResult {
  program: ConditionProgram | null
  issues: ProgramIssue[]
}
