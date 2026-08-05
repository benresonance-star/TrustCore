export interface PortabilityRunScope {
  readonly runId: string;
  readonly sourceDatabase: string;
  readonly targetDatabase: string;
  readonly sourceBucket: string;
  readonly targetBucket: string;
}

export function createRunScope(value?: string): PortabilityRunScope;
export function quotePostgresIdentifier(value: string): string;
export function assertScopedBucket(value: string, runId: string): string;
export function safeFailureDetail(error: unknown): string;
export function markdownReport(report: {
  readonly status: string;
  readonly clean: boolean;
  readonly gitSha: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly environment: {
    readonly platform: string;
    readonly node: string;
    readonly docker: string | null;
  };
  readonly stages: readonly {
    readonly name: string;
    readonly status: string;
    readonly durationMs: number;
    readonly detail?: string;
  }[];
}): string;
