export class WorkflowEntrypoint<Environment = unknown, Parameters = unknown> {
  protected env: Environment

  constructor(_ctx: ExecutionContext, env: Environment) {
    this.env = env
  }

  async run(_event: WorkflowEvent<Parameters>, _step: WorkflowStep): Promise<unknown> {
    return undefined
  }
}

export type { WorkflowEvent, WorkflowStep }

