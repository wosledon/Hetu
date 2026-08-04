using System.Net.WebSockets;
using System.Text;
using Hetu.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>工作终端：WebSocket 双向通道，后台 shell 运行在项目根目录</summary>
[ApiController]
[Route("api/work-terminal")]
public class WorkTerminalController : ControllerBase
{
    private readonly WorkTerminalManager _manager;

    public WorkTerminalController(WorkTerminalManager manager)
    {
        _manager = manager;
    }

    [HttpGet("{projectId:guid}/connect")]
    public async Task Connect(Guid projectId, CancellationToken ct)
    {
        if (!HttpContext.WebSockets.IsWebSocketRequest)
        {
            HttpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var (session, error) = await _manager.GetOrCreateAsync(projectId, ct);
        if (session == null)
        {
            HttpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            await HttpContext.Response.WriteAsync(error ?? "终端初始化失败", ct);
            return;
        }

        using var webSocket = await HttpContext.WebSockets.AcceptWebSocketAsync();
        var buffer = new byte[4096];
        var sendLock = new SemaphoreSlim(1, 1);

        // 输出 → WebSocket
        var outputTask = Task.Run(async () =>
        {
            try
            {
                await foreach (var chunk in session.Output.ReadAllAsync(ct))
                {
                    var payload = Encoding.UTF8.GetBytes(chunk);
                    await sendLock.WaitAsync(ct);
                    try
                    {
                        if (webSocket.State == WebSocketState.Open)
                            await webSocket.SendAsync(new ArraySegment<byte>(payload), WebSocketMessageType.Text, true, ct);
                    }
                    finally { sendLock.Release(); }
                }
            }
            catch (OperationCanceledException) { }
            catch (WebSocketException) { }
        }, ct);

        // WebSocket → 输入
        try
        {
            while (webSocket.State == WebSocketState.Open)
            {
                var result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close) break;
                if (result.MessageType == WebSocketMessageType.Text && result.Count > 0)
                {
                    var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    session.Write(text);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
        finally
        {
            ct.ThrowIfCancellationRequested();
            try { await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "closed", CancellationToken.None); } catch { }
            await Task.WhenAny(outputTask, Task.Delay(500));
        }
    }

    [HttpPost("{projectId:guid}/stop")]
    public async Task<IActionResult> Stop(Guid projectId)
    {
        await _manager.StopAsync(projectId);
        return Ok(new { success = true });
    }
}
