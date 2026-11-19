export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class AgentRouterModelUnavailable extends AppError {
  constructor() {
    super(503, 'AgentRouter has no available route for the configured model. Check the model selected for Copy Studio.');
  }
}

export class AgentRouterContentFiltered extends AppError {
  constructor() {
    super(502, 'AgentRouter stopped this request because of its content filter.');
  }
}

export function isAgentRouterModelUnavailable(message: string) {
  return /无可用渠道|no available (?:channels?|routes?)|no[-_ ]channel/i.test(message);
}
export function publicError(error: unknown): { status: number; message: string } {
  if (error instanceof AppError) return { status: error.status, message: error.message };
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return {
      status: 504,
      message: 'The request timed out or was cancelled. Your saved work is safe. Please try again.',
    };
  }
  return {
    status: 500,
    message: 'Something went wrong. Your saved work is safe. Please try again.',
  };
}
