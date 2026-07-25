/**
 * Control-flow signals a pure `buildPlan` may throw. The IPC bridge translates
 * them: PlanError → UserError toast, NeedsOptions → open the named options
 * window and re-plan with the submitted values.
 */

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

export class NeedsOptions extends Error {
  readonly window: string;
  constructor(window: string) {
    super(`needs options window: ${window}`);
    this.name = "NeedsOptions";
    this.window = window;
  }
}
