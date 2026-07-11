import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";

type ErrorRequest = {
  id?: string;
  originalUrl?: string;
  url?: string;
};

type ErrorResponse = {
  status: (statusCode: number) => {
    json: (body: unknown) => void;
  };
};

@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<ErrorRequest>();
    const response = context.getResponse<ErrorResponse>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const details = exception instanceof HttpException ? this.httpDetails(exception) : {};

    response.status(statusCode).json({
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url ?? null,
      requestId: request.id ?? null,
      ...details,
      ...(statusCode >= 500
        ? {
            message: "Internal server error",
            error: "Internal Server Error"
          }
        : {})
    });
  }

  private httpDetails(exception: HttpException) {
    const payload = exception.getResponse();

    if (typeof payload === "string") {
      return {
        message: payload,
        error: exception.name
      };
    }

    if (!payload || typeof payload !== "object") {
      return {
        message: exception.message,
        error: exception.name
      };
    }

    const record = payload as Record<string, unknown>;

    return {
      message: record.message ?? exception.message,
      error: record.error ?? exception.name,
      ...(record.issues ? { issues: record.issues } : {})
    };
  }
}
