using System.Text.Json;
using Hetu.Core.Exceptions;
using Hetu.Shared.Common;

namespace Hetu.Api.Middleware;

public class GlobalExceptionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<GlobalExceptionMiddleware> _logger;

    public GlobalExceptionMiddleware(RequestDelegate next, ILogger<GlobalExceptionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (BusinessException ex)
        {
            _logger.LogWarning(ex, "业务异常");
            await WriteErrorAsync(context, ex.Message, StatusCodes.Status400BadRequest);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // 前端切页/取消请求时客户端已断开，不是服务端错误；避免刷 500 与堆栈
            _logger.LogDebug("请求已由客户端取消：{Path}", context.Request.Path);
            if (!context.Response.HasStarted)
                context.Response.StatusCode = 499;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "未处理异常");
            await WriteErrorAsync(context, "服务器内部错误", StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task WriteErrorAsync(HttpContext context, string message, int statusCode)
    {
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json";
        var response = ApiResponse.Fail(message);
        await context.Response.WriteAsync(JsonSerializer.Serialize(response));
    }
}
